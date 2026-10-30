package com.sunhub.community

import android.app.Application
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import kotlinx.coroutines.*
import org.json.JSONObject

data class AppRelease(
    val code: Int,
    val name: String,
    val url: String,
    val hash: String,
    val notes: List<String>,
)

class AppUpdates(application: Application) : AndroidViewModel(application) {
    var release by mutableStateOf<AppRelease?>(null)
        private set

    var checking by mutableStateOf(false)
        private set

    var downloading by mutableStateOf(false)
        private set

    var progress by mutableIntStateOf(0)
        private set

    var ready by mutableStateOf<File?>(null)
        private set

    var error by mutableStateOf<String?>(null)
        private set

    var message by mutableStateOf<String?>(null)
        private set

    var visible by mutableStateOf(false)
        private set

    private var lastCheck = 0L
    private var download: Job? = null
    private val prefs = application.getSharedPreferences("connect-updates", 0)

    fun check(force: Boolean = false) {
        if (checking || !force && System.currentTimeMillis() - lastCheck < 6 * 60 * 60 * 1000)
            return
        checking = true
        error = null
        message = null
        lastCheck = System.currentTimeMillis()
        viewModelScope.launch {
            try {
                val json =
                    withContext(Dispatchers.IO) {
                        val c =
                            URL(BuildConfig.API_URL.trimEnd('/') + "/api/mobile/releases/android")
                                .openConnection() as HttpURLConnection
                        c.connectTimeout = 12000
                        c.readTimeout = 12000
                        c.instanceFollowRedirects = false
                        try {
                            check(c.responseCode == 200)
                            val text = c.inputStream.bufferedReader().use { it.readText() }
                            check(text.length < 20000)
                            JSONObject(text)
                        } finally {
                            c.disconnect()
                        }
                    }
                val code = json.getInt("versionCode")
                require(json.getString("packageName") == BuildConfig.APPLICATION_ID)
                require(json.getInt("minSdk") <= Build.VERSION.SDK_INT)
                if (code > BuildConfig.VERSION_CODE) {
                    val url = json.getString("url")
                    require(
                        url.matches(
                            Regex(
                                "https://github\\.com/hasnainkazmee-bit/Connect/releases/download/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+\\.apk"
                            )
                        )
                    )
                    val hash = json.getString("sha256")
                    require(hash.matches(Regex("[a-f0-9]{64}")))
                    release =
                        AppRelease(
                            code,
                            json.getString("versionName"),
                            url,
                            hash,
                            json.optJSONArray("notes").strings(),
                        )
                    visible = force || prefs.getInt("dismissed", 0) != code
                } else {
                    release = null
                    visible = false
                    if (force) message = "You’re up to date. Connect ${BuildConfig.VERSION_NAME}."
                }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                if (force) error = "Couldn’t check for updates. Try again when you’re online."
            } finally {
                checking = false
            }
        }
    }

    fun show() {
        visible = true
        error = null
    }

    fun later() {
        visible = false
        release?.let { prefs.edit().putInt("dismissed", it.code).apply() }
    }

    fun cancel() {
        download?.cancel()
        download = null
        downloading = false
        progress = 0
    }

    fun reportInstallError() {
        error = "Android couldn’t open the installer. Try again from Account → App updates."
    }

    private fun digest(file: File): String {
        val hash = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(65536)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                hash.update(buffer, 0, count)
            }
        }
        return hash.digest().joinToString("") { "%02x".format(it) }
    }

    @Suppress("DEPRECATION")
    private fun validate(file: File, r: AppRelease) {
        require(digest(file) == r.hash) {
            "Download verification failed. Please download the update again."
        }
        val pm = getApplication<Application>().packageManager
        val flags =
            if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES
            else PackageManager.GET_SIGNATURES
        val candidate =
            pm.getPackageArchiveInfo(file.absolutePath, flags)
                ?: throw IllegalStateException("This update could not be read.")
        val installed = pm.getPackageInfo(BuildConfig.APPLICATION_ID, flags)
        require(candidate.packageName == BuildConfig.APPLICATION_ID) {
            "This update is for a different app."
        }
        val version =
            if (Build.VERSION.SDK_INT >= 28) candidate.longVersionCode
            else candidate.versionCode.toLong()
        require(version == r.code.toLong() && version > BuildConfig.VERSION_CODE) {
            "This update version is not valid."
        }
        val incoming =
            if (Build.VERSION.SDK_INT >= 28) candidate.signingInfo?.apkContentsSigners
            else candidate.signatures
        val current =
            if (Build.VERSION.SDK_INT >= 28) installed.signingInfo?.apkContentsSigners
            else installed.signatures
        require(
            !incoming.isNullOrEmpty() &&
                !current.isNullOrEmpty() &&
                incoming.toSet() == current.toSet()
        ) {
            "This update was not signed by the same Connect developer."
        }
    }

    fun downloadUpdate() {
        val r = release ?: return
        if (downloading) return
        downloading = true
        progress = 0
        error = null
        ready = null
        download =
            viewModelScope.launch {
                val directory =
                    File(getApplication<Application>().cacheDir, "updates").apply { mkdirs() }
                val target = File(directory, "connect-${r.code}.apk")
                val partial = File(directory, "connect-${r.code}.part")
                try {
                    withContext(Dispatchers.IO) {
                        if (target.exists()) {
                            runCatching { validate(target, r) }.onFailure { target.delete() }
                        }
                        if (!target.exists()) {
                            var url = URL(r.url)
                            var connection: HttpURLConnection? = null
                            for (attempt in 0..5) {
                                require(
                                    url.protocol == "https" &&
                                        url.host in
                                            setOf(
                                                "github.com",
                                                "release-assets.githubusercontent.com",
                                                "objects.githubusercontent.com",
                                            )
                                ) {
                                    "Unexpected update download location."
                                }
                                val c = url.openConnection() as HttpURLConnection
                                c.connectTimeout = 15000
                                c.readTimeout = 30000
                                c.instanceFollowRedirects = false
                                val status = c.responseCode
                                if (status in listOf(301, 302, 303, 307, 308)) {
                                    val next = c.getHeaderField("Location")
                                    c.disconnect()
                                    require(next != null)
                                    url = URL(url, next)
                                } else {
                                    require(status == 200) {
                                        "The update is not available yet. Try again shortly."
                                    }
                                    connection = c
                                    break
                                }
                            }
                            val c =
                                connection
                                    ?: throw IllegalStateException(
                                        "Couldn’t reach the update download."
                                    )
                            try {
                                val length = c.contentLengthLong
                                require(length <= 300L * 1024 * 1024) {
                                    "Update exceeds the download limit."
                                }
                                var total = 0L
                                var last = -1
                                c.inputStream.use { input ->
                                    partial.outputStream().use { output ->
                                        val buffer = ByteArray(65536)
                                        while (true) {
                                            ensureActive()
                                            val count = input.read(buffer)
                                            if (count < 0) break
                                            total += count
                                            require(total <= 300L * 1024 * 1024)
                                            output.write(buffer, 0, count)
                                            val percent =
                                                if (length > 0)
                                                    (total * 100 / length).toInt().coerceIn(0, 99)
                                                else 0
                                            if (percent != last) {
                                                last = percent
                                                withContext(Dispatchers.Main) { progress = percent }
                                            }
                                        }
                                    }
                                }
                                require(total > 0)
                                validate(partial, r)
                                require(partial.renameTo(target)) {
                                    "Couldn’t save the update. Free some space and try again."
                                }
                            } finally {
                                c.disconnect()
                            }
                        }
                        validate(target, r)
                        directory
                            .listFiles()
                            ?.filter { it != target && it != partial }
                            ?.forEach { it.delete() }
                    }
                    ready = target
                    progress = 100
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    error =
                        e.message?.takeIf { it.isNotBlank() && it.length < 180 }
                            ?: "Download interrupted. Try again; your account and messages are safe."
                } finally {
                    withContext(NonCancellable + Dispatchers.IO) { partial.delete() }
                    downloading = false
                }
            }
    }
}

@Composable
internal fun UpdateBanner(updates: AppUpdates, onOpen: () -> Unit) {
    val r = updates.release ?: return
    if (!updates.visible) return
    Surface(color = Pale, tonalElevation = 1.dp) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(Icons.Outlined.SystemUpdate, null, tint = Muted, modifier = Modifier.size(20.dp))
            Column(Modifier.weight(1f)) {
                Text("A new Connect is ready", style = MaterialTheme.typography.labelLarge)
                Text(
                    "Version ${r.name}",
                    color = Muted,
                    style = MaterialTheme.typography.labelSmall,
                )
            }
            TextButton(onClick = onOpen) { Text("Update") }
        }
    }
}

@Composable
internal fun UpdateDialog(updates: AppUpdates, onClose: () -> Unit) {
    val context = LocalContext.current
    val r = updates.release
    fun install() {
        val file = updates.ready ?: return
        try {
            val uri =
                FileProvider.getUriForFile(
                    context,
                    "${BuildConfig.APPLICATION_ID}.attachments",
                    file,
                )
            context.startActivity(
                Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            )
        } catch (_: Exception) {
            updates.reportInstallError()
        }
    }
    var permission by remember { mutableStateOf(false) }
    val launcher =
        rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
            if (context.packageManager.canRequestPackageInstalls()) install()
        }
    AlertDialog(
        onDismissRequest = { if (!updates.downloading) onClose() },
        icon = { Icon(Icons.Outlined.SystemUpdate, null, tint = Orange) },
        title = { Text(if (r != null) "Meet Connect ${r.name}" else "App updates") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(13.dp)) {
                if (r != null) {
                    Text(
                        "Your account, messages, and drafts stay right here.",
                        color = Muted,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    r.notes.forEach { Text("• $it", style = MaterialTheme.typography.bodySmall) }
                }
                if (updates.checking) LinearProgressIndicator(Modifier.fillMaxWidth())
                if (updates.downloading) {
                    LinearProgressIndicator(
                        progress = { updates.progress / 100f },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Text(
                        "Downloading ${updates.progress}%",
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
                if (updates.ready != null)
                    Text(
                        "Download verified. Android will ask you to confirm the update.",
                        style = MaterialTheme.typography.bodySmall,
                        color = Muted,
                    )
                updates.error?.let {
                    Text(
                        it,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                updates.message?.let {
                    Text(it, color = Muted, style = MaterialTheme.typography.bodyMedium)
                }
                if (permission)
                    Text(
                        "Allow updates from Connect on the next screen. This lets Android install the update you requested.",
                        style = MaterialTheme.typography.bodySmall,
                        color = Muted,
                    )
            }
        },
        confirmButton = {
            TextButton(
                enabled = !updates.checking && !updates.downloading,
                onClick = {
                    when {
                        r == null -> updates.check(true)
                        updates.ready == null -> updates.downloadUpdate()
                        !context.packageManager.canRequestPackageInstalls() -> {
                            if (permission)
                                launcher.launch(
                                    Intent(
                                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                        Uri.parse("package:${BuildConfig.APPLICATION_ID}"),
                                    )
                                )
                            else permission = true
                        }
                        else -> install()
                    }
                },
            ) {
                Text(
                    when {
                        r == null -> "Check for updates"
                        updates.ready == null -> "Download update"
                        permission && !context.packageManager.canRequestPackageInstalls() ->
                            "Continue to Android settings"
                        else -> "Install update"
                    }
                )
            }
        },
        dismissButton = {
            TextButton(
                onClick = {
                    if (updates.downloading) updates.cancel()
                    else {
                        updates.later()
                        onClose()
                    }
                }
            ) {
                Text(if (updates.downloading) "Cancel download" else "Later")
            }
        },
    )
}
