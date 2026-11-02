package com.sunhub.community

import android.app.Application
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.*
import androidx.core.content.FileProvider
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.sunhub.core.ChangeObserver
import com.sunhub.core.CommunityClient
import com.sunhub.core.CoreException
import com.sunhub.core.EventWatch
import com.sunhub.core.UploadFile
import java.io.File
import java.net.URLEncoder
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject

fun JSONArray?.objects(): List<JSONObject> =
    if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }

fun JSONArray?.strings(): List<String> =
    if (this == null) emptyList() else (0 until length()).map { optString(it) }

fun query(value: String): String = URLEncoder.encode(value, "UTF-8")

enum class Tab {
    Home,
    Companies,
    Network,
    Messages,
}

class CommunityModel
@JvmOverloads
constructor(application: Application, apiUrl: String = BuildConfig.API_URL) :
    AndroidViewModel(application) {
    val baseUrl = apiUrl.trimEnd('/')
    private val store = SessionStore(application)
    private var client: CommunityClient? = null
    val pages = mutableStateMapOf<String, JSONObject>()
    private val loads = mutableMapOf<String, Job>()
    private val writes = Mutex()
    private var epoch = 0
    private var foreground = false
    private var watcher: EventWatch? = null
    private var watchJob: Job? = null
    private var pollJob: Job? = null
    private var sessionJob: Job? = null
    private var refreshJob: Job? = null
    var session by mutableStateOf<JSONObject?>(null)
        private set

    var verificationChallenge by mutableStateOf("")
        private set

    val needsOnboarding
        get() =
            signedIn &&
                session?.optBoolean("verificationRequired", true) != false &&
                (session?.optJSONObject("user")?.isNull("email_verified_at") != false ||
                    session?.optJSONObject("user")?.isNull("onboarding_completed_at") != false)

    fun accountAction(
        path: String,
        data: JSONObject = JSONObject(),
        done: (JSONObject) -> Unit = {},
    ) =
        mutate(path, data) { value ->
            if (value.has("user")) {
                session = value
                resetContent()
                if (company != null) load("/network")
                load("/feed?scope=all")
            }
            value
                .optString("challengeId")
                .takeIf { it.isNotBlank() && it != "null" }
                ?.let { verificationChallenge = it }
            viewModelScope.launch(Dispatchers.IO) { store.save(client!!.sessionCookie()) }
            done(value)
        }

    suspend fun attachmentPreview(attachment: JSONObject): File? {
        val capturedEpoch = epoch
        val id = java.util.UUID.fromString(attachment.getString("id")).toString()
        val file =
            withContext(Dispatchers.IO) {
                val directory =
                    File(getApplication<Application>().cacheDir, "attachments").apply { mkdirs() }
                File(directory, id).also {
                    client!!.downloadAttachment("/attachments/$id", it.absolutePath)
                }
            }
        return if (capturedEpoch == epoch) file else null
    }

    var tab by mutableStateOf(Tab.Home)
        private set

    var profileId by mutableStateOf<String?>(null)
        private set

    var chatCompany by mutableStateOf<JSONObject?>(null)
        private set

    var busy by mutableStateOf(false)
        private set

    var booting by mutableStateOf(true)
        private set

    var error by mutableStateOf<String?>(null)
        private set

    var offline by mutableStateOf(false)
        private set

    val individual
        get() = session?.optJSONObject("user")?.optString("account_type") == "individual"

    val signedIn
        get() = session?.optJSONObject("user") != null

    val companies
        get() = session?.optJSONArray("companies").objects()

    val company
        get() =
            companies.firstOrNull { it.optString("id") == session?.optString("activeCompanyId") }

    val admin
        get() = company?.optString("role") in listOf("owner", "admin")

    val network
        get() = pages["/network"] ?: JSONObject()

    val connections
        get() = network.optJSONArray("connections").objects()

    val incoming
        get() = network.optJSONArray("incoming").objects()

    val sent
        get() = network.optJSONArray("sent").objects()

    val currentConnection
        get() =
            connections.firstOrNull {
                it.optJSONObject("company")?.optString("id") == chatCompany?.optString("id")
            }

    val currentRequest
        get() =
            (incoming + sent).firstOrNull {
                it.optJSONObject("company")?.optString("id") == chatCompany?.optString("id")
            }

    val messagePath
        get() = currentConnection?.let { "/conversations/${it.optString("id")}/messages" }

    init {
        viewModelScope.launch {
            try {
                client =
                    withContext(Dispatchers.IO) {
                        CommunityClient(
                                baseUrl,
                                application.filesDir.resolve("community-cache.sqlite").absolutePath,
                                BuildConfig.DEBUG,
                            )
                            .also { core ->
                                store.read()?.let { saved ->
                                    runCatching { core.restoreSession(saved) }
                                        .onFailure { store.clear() }
                                }
                            }
                    }
                val cached = withContext(Dispatchers.IO) { client!!.cached("/session") }
                cached?.let { session = parsePage(it.json) }
                booting = false
                load("/feed?scope=all")
                loadSession()
            } catch (e: Exception) {
                error = displayError(e)
                booting = false
            }
        }
    }

    private fun parsePage(value: String): JSONObject =
        if (value.trimStart().startsWith("[")) JSONObject().put("items", JSONArray(value))
        else JSONObject(value)

    private fun displayError(error: Exception): String =
        when (error) {
            is CoreException.Api -> error.detail
            is CoreException.Invalid -> error.detail
            is CoreException.Network -> error.detail
            is CoreException.Storage -> "Saved content is unavailable. Please try again."
            is CoreException.ContextChanged -> "Your company changed. Please try again."
            else -> "Something went wrong. Please try again."
        }

    fun dismissError() {
        error = null
    }

    fun load(path: String, force: Boolean = false) {
        val core = client ?: return
        if (loads[path]?.isActive == true && !force) return
        loads[path]?.cancel()
        val capturedEpoch = epoch
        loads[path] =
            viewModelScope.launch {
                try {
                    if (!pages.containsKey(path))
                        withContext(Dispatchers.IO) { core.cached(path) }
                            ?.let { if (capturedEpoch == epoch) pages[path] = parsePage(it.json) }
                    val json = withContext(Dispatchers.IO) { parsePage(core.get(path)) }
                    if (capturedEpoch != epoch) return@launch
                    if (pages.size > 48)
                        pages.keys
                            .firstOrNull { it != "/network" && it != path }
                            ?.let { pages.remove(it) }
                    pages[path] = json
                    offline = false
                    if (path == "/network") messagePath?.let { load(it) }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    if (capturedEpoch == epoch) {
                        if (e is CoreException.Api) {
                            pages.remove(path)
                            if (e.status.toInt() == 401) {
                                loads.remove(path)
                                clearLocalSession()
                                load("/feed?scope=all")
                            }
                        }
                        offline = e is CoreException.Network
                        if (!offline && e !is CoreException.ContextChanged) error = displayError(e)
                    }
                }
            }
    }

    private fun loadSession() {
        if (sessionJob?.isActive == true) return
        val core = client ?: return
        val capturedEpoch = epoch
        sessionJob =
            viewModelScope.launch {
                try {
                    val value = withContext(Dispatchers.IO) { JSONObject(core.get("/session")) }
                    if (capturedEpoch != epoch) return@launch
                    offline = false
                    val hadAccount = signedIn
                    session = value
                    if (value.optJSONObject("user") == null) {
                        if (hadAccount) clearLocalSession()
                        load("/feed?scope=all")
                    } else {
                        if (company != null) load("/network")
                        observe(foreground)
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    if (capturedEpoch == epoch) {
                        offline = e is CoreException.Network
                        if (!offline && e !is CoreException.ContextChanged) error = displayError(e)
                    }
                }
            }
    }

    fun retryConnection() {
        if (client == null) return
        error = null
        loadSession()
        // Retry recent screens, including a failed first load that has no cached page yet.
        loads.keys.toList().takeLast(8).forEach { load(it, true) }
    }

    fun authenticate(
        email: String,
        password: String,
        name: String? = null,
        companyName: String? = null,
        accountType: String = "company",
    ) {
        val data = JSONObject().put("email", email.trim()).put("password", password)
        if (name != null)
            data.put("name", name).put("companyName", companyName).put("accountType", accountType)
        mutate(if (name == null) "/auth/login" else "/auth/register", data) { response ->
            resetContent()
            session = response
            verificationChallenge =
                response.optString("challengeId").takeUnless { it == "null" }.orEmpty()
            viewModelScope.launch(Dispatchers.IO) { store.save(client!!.sessionCookie()) }
            loadSession()
            if (company != null) load("/network")
            load("/feed?scope=all")
            observe(foreground)
            profileId?.let { profile(it) }
        }
    }

    fun switchCompany(id: String) =
        mutate("/session/company", JSONObject().put("companyId", id)) {
            resetContent()
            session = it
            profileId = null
            chatCompany = null
            loadSession()
            if (company != null) load("/network")
            load("/feed?scope=all")
            observe(foreground)
        }

    fun logout() =
        viewModelScope.launch {
            if (busy) return@launch
            busy = true
            observe(false)
            try {
                runCatching {
                    writes.withLock {
                        withContext(Dispatchers.IO) { client?.postJson("/auth/logout", "{}") }
                    }
                }
                clearLocalSession()
                load("/feed?scope=all")
            } finally {
                busy = false
            }
        }

    private fun resetContent() {
        epoch++
        loads.values.forEach { it.cancel() }
        loads.clear()
        pages.clear()
    }

    private suspend fun clearLocalSession() {
        resetContent()
        watchJob?.cancel()
        pollJob?.cancel()
        refreshJob?.cancel()
        watcher?.cancel()
        watcher = null
        withContext(Dispatchers.IO) {
            client?.clearSession()
            store.clear()
            File(getApplication<Application>().cacheDir, "attachments").deleteRecursively()
            File(getApplication<Application>().cacheDir, "uploads").deleteRecursively()
        }
        session = null
        chatCompany = null
        profileId = null
        tab = Tab.Home
    }

    fun selectTab(value: Tab) {
        tab = value
        profileId = null
        chatCompany = null
    }

    fun profile(id: String) {
        profileId = id
        load("/companies/$id")
        load("/social/companies/$id")
    }

    fun chat(value: JSONObject) {
        tab = Tab.Messages
        profileId = null
        chatCompany = value
        if (individual) load("/personal-inbox") else load("/network")
        load("/companies/${value.optString("id")}")
    }

    fun back() {
        if (profileId != null) profileId = null else chatCompany = null
    }

    fun mutate(path: String, body: JSONObject, done: (JSONObject) -> Unit = {}) {
        if (busy) return
        busy = true
        error = null
        viewModelScope.launch {
            try {
                val result =
                    writes.withLock {
                        withContext(Dispatchers.IO) {
                            JSONObject(client!!.postJson(path, body.toString()))
                        }
                    }
                done(result)
            } catch (e: Exception) {
                error = displayError(e)
            } finally {
                busy = false
            }
        }
    }

    suspend fun jsonRequest(
        method: String,
        path: String,
        body: JSONObject = JSONObject(),
    ): JSONObject =
        withContext(Dispatchers.IO) {
            parsePage(client!!.requestJson(method, path, body.toString()))
        }

    suspend fun fetchJson(path: String): JSONObject =
        withContext(Dispatchers.IO) { parsePage(client!!.get(path)) }

    suspend fun uploadOne(path: String, file: UploadFile): JSONObject =
        withContext(Dispatchers.IO) { JSONObject(client!!.uploadFile(path, file)) }

    fun perform(work: suspend () -> JSONObject, done: (JSONObject) -> Unit = {}) {
        if (busy) return
        busy = true
        error = null
        viewModelScope.launch {
            try {
                val result = writes.withLock { work() }
                done(result)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = displayError(e)
            } finally {
                busy = false
            }
        }
    }

    fun refreshCompany() {
        loadSession()
        company?.optString("id")?.let { load("/companies/$it", true) }
        load("/feed?scope=all", true)
    }

    fun sendRequest(text: String, done: () -> Unit) {
        val id = chatCompany?.optString("id") ?: return
        mutate(
            "/requests",
            JSONObject().put("companyId", id).put("kind", "message").put("note", text),
        ) {
            done()
            load("/network", true)
            load("/companies/$id", true)
        }
    }

    fun respond(request: JSONObject, action: String) =
        mutate("/requests/${request.optString("id")}/respond", JSONObject().put("action", action)) {
            load("/network", true)
            chatCompany?.let { load("/companies/${it.optString("id")}", true) }
        }

    fun sendText(
        path: String,
        text: String,
        files: List<UploadFile> = emptyList(),
        clientId: String? = null,
        done: () -> Unit,
    ) {
        if (busy || (text.isBlank() && files.isEmpty())) return
        busy = true
        error = null
        viewModelScope.launch {
            try {
                writes.withLock {
                    withContext(Dispatchers.IO) {
                        client!!.postMedia(
                            if (clientId == null) path else "$path?clientId=$clientId",
                            text,
                            files,
                        )
                    }
                }
                withContext(Dispatchers.IO) { MediaFiles.discard(files) }
                done()
                load("/network", true)
                if (path == "/posts") load("/feed?scope=all", true) else load(path, true)
            } catch (e: Exception) {
                error = displayError(e)
            } finally {
                busy = false
            }
        }
    }

    fun pickMedia(
        uris: List<Uri>,
        post: Boolean,
        publication: Boolean = false,
        done: (List<UploadFile>) -> Unit,
    ) =
        viewModelScope.launch {
            if (uris.isEmpty() || busy) return@launch
            busy = true
            val capturedEpoch = epoch
            try {
                val selected =
                    withContext(Dispatchers.IO) {
                        MediaFiles.import(getApplication(), uris, post, publication)
                    }
                if (capturedEpoch == epoch) done(selected)
                else withContext(Dispatchers.IO) { MediaFiles.discard(selected) }
            } catch (e: Exception) {
                error = e.message ?: "Couldn’t attach this file."
            } finally {
                busy = false
            }
        }

    fun mediaCookie(): String = client?.sessionCookie().orEmpty()

    fun openPublicationMedia(media: JSONObject) =
        viewModelScope.launch {
            val context = getApplication<Application>()
            val captured = epoch
            try {
                val id = java.util.UUID.fromString(media.getString("id")).toString()
                val file =
                    withContext(Dispatchers.IO) {
                        val directory = File(context.cacheDir, "attachments").apply { mkdirs() }
                        File(directory, id).also {
                            client!!.downloadAttachment("/post-media/$id", it.absolutePath)
                        }
                    }
                if (captured != epoch) {
                    file.delete()
                    return@launch
                }
                val uri =
                    FileProvider.getUriForFile(
                        context,
                        "${BuildConfig.APPLICATION_ID}.attachments",
                        file,
                    )
                context.startActivity(
                    Intent(Intent.ACTION_VIEW)
                        .setDataAndType(uri, media.text("mime"))
                        .addFlags(
                            Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
                        )
                )
            } catch (e: Exception) {
                error = displayError(e)
            }
        }

    fun openAttachment(attachment: JSONObject) =
        viewModelScope.launch {
            val context = getApplication<Application>()
            try {
                val id = java.util.UUID.fromString(attachment.getString("id")).toString()
                val file =
                    withContext(Dispatchers.IO) {
                        val directory = File(context.cacheDir, "attachments").apply { mkdirs() }
                        File(directory, id).also {
                            client!!.downloadAttachment("/attachments/$id", it.absolutePath)
                        }
                    }
                val uri =
                    FileProvider.getUriForFile(
                        context,
                        "${BuildConfig.APPLICATION_ID}.attachments",
                        file,
                    )
                context.startActivity(
                    Intent(Intent.ACTION_VIEW)
                        .setDataAndType(uri, attachment.optString("mime"))
                        .addFlags(
                            Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
                        )
                )
            } catch (e: android.content.ActivityNotFoundException) {
                error = "Install an app that can open this file type."
            } catch (e: Exception) {
                error = displayError(e)
            }
        }

    fun observe(active: Boolean) {
        val wasForeground = foreground
        foreground = active
        watchJob?.cancel()
        pollJob?.cancel()
        watcher?.cancel()
        watcher = null
        if (active && !wasForeground && offline) retryConnection()
        if (!active || company == null || client == null) return
        val observedEpoch = epoch
        if (BuildConfig.POLL_EVENTS) {
            pollJob =
                viewModelScope.launch {
                    while (isActive && foreground && epoch == observedEpoch) {
                        delay(5_000)
                        if (offline) retryConnection()
                        else {
                            load("/network")
                            chatCompany?.let { load("/companies/${it.optString("id")}") }
                        }
                    }
                }
            return
        }
        watchJob =
            viewModelScope.launch {
                var created: EventWatch? = null
                try {
                    withContext(Dispatchers.IO) {
                        created =
                            client!!.watchChanges(
                                object : ChangeObserver {
                                    override fun changed() {
                                        viewModelScope.launch {
                                            if (epoch != observedEpoch || !foreground) return@launch
                                            refreshJob?.cancel()
                                            refreshJob =
                                                viewModelScope.launch {
                                                    delay(120)
                                                    if (foreground && epoch == observedEpoch) {
                                                        load("/network", true)
                                                        chatCompany?.let {
                                                            load(
                                                                "/companies/${it.optString("id")}",
                                                                true,
                                                            )
                                                        }
                                                    }
                                                }
                                        }
                                    }
                                }
                            )
                    }
                    if (foreground && epoch == observedEpoch) {
                        watcher = created
                        created = null
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    /* Pull-to-refresh remains available when live updates cannot start. */
                } finally {
                    created?.cancel()
                }
            }
    }

    override fun onCleared() {
        watcher?.cancel()
        super.onCleared()
    }
}
