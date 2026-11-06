package com.sunhub.community

import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import android.Manifest
import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.*
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailabilityLight
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.sunhub.core.CommunityClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

class ConnectApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        PushNotifications.initialize(this)
    }
}

internal data class NotificationDestination(val route: String, val id: String? = null, val commentId: String? = null) {
    companion object {
        fun uuid(value: String?): String? = value?.takeIf {
            it.matches(Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"))
        }?.lowercase()

        /** A notification cannot launch an arbitrary URL or supply an API request. */
        fun parse(url: String, origin: String = BuildConfig.API_URL): NotificationDestination? = runCatching {
            if (url.length > 512 || url.contains('\\') || url.any { it.code < 32 }) return null
            val uri = Uri.parse(url)
            if (uri.fragment != null || uri.userInfo != null) return null
            if (uri.isAbsolute) {
                val expected = Uri.parse(origin)
                if (uri.scheme != expected.scheme || uri.host != expected.host || uri.port != expected.port) return null
            } else if (!url.startsWith('/') || url.startsWith("//")) return null
            val path = uri.encodedPath ?: return null
            if ('%' in path) return null
            fun onlyQuery(name: String): String? {
                if (uri.queryParameterNames != setOf(name) || uri.getQueryParameters(name).size != 1) return null
                return uuid(uri.getQueryParameter(name))
            }
            when {
                path == "/account/updates" && uri.query == null -> NotificationDestination("updates")
                path == "/messages" && uri.query == null -> NotificationDestination("messages")
                path == "/messages" && uri.queryParameterNames == setOf("conversation") -> onlyQuery("conversation")?.let { NotificationDestination("conversation", it) }
                path == "/messages" && uri.queryParameterNames == setOf("company") -> onlyQuery("company")?.let { NotificationDestination("companyChat", it) }
                path == "/messages" && uri.queryParameterNames == setOf("personal") -> onlyQuery("personal")?.let { NotificationDestination("personal", it) }
                path.startsWith("/posts/") -> uuid(path.removePrefix("/posts/"))?.let {
                    if (uri.query == null) NotificationDestination("post", it)
                    else onlyQuery("comment")?.let { comment -> NotificationDestination("post", it, comment) }
                }
                path.startsWith("/company/") && uri.query == null -> uuid(path.removePrefix("/company/"))?.let { NotificationDestination("profile", it) }
                path.matches(Regex("/join/[a-z0-9][a-z0-9-]{1,79}")) && uri.query == null -> NotificationDestination("invite", path)
                else -> null
            }
        }.getOrNull()
    }
}

internal data class PushBinding(val userId: String, val bindingId: String, val installationId: String, val deviceId: String?)
internal data class PushNotice(val id: String, val userId: String, val bindingId: String, val type: String, val title: String, val body: String, val url: String, val companyId: String?, val destination: NotificationDestination) {
    fun json() = JSONObject().put("id", id).put("recipientUserId", userId).put("bindingId", bindingId).put("type", type).put("title", title).put("body", body).put("url", url).put("companyId", companyId ?: "")
    companion object {
        fun parse(data: Map<String, String>): PushNotice? {
            val id = NotificationDestination.uuid(data["id"]) ?: return null
            val user = NotificationDestination.uuid(data["recipientUserId"]) ?: return null
            val binding = NotificationDestination.uuid(data["bindingId"]) ?: return null
            val url = data["url"] ?: return null
            val destination = NotificationDestination.parse(url) ?: return null
            val company = data["companyId"]?.takeIf { it.isNotBlank() }?.let { NotificationDestination.uuid(it) ?: return null }
            return PushNotice(id, user, binding, data["type"].orEmpty().take(80), data["title"].orEmpty().take(160).ifBlank { "Connect" }, data["body"].orEmpty().take(400), url, company, destination)
        }
        fun parse(json: JSONObject): PushNotice? = parse(json.keys().asSequence().associateWith { json.optString(it) })
    }
}

/** Non-secret device metadata only. Authentication remains in Android Keystore-backed SessionStore. */
internal class PushDeviceStore(context: Context, name: String = "connect-push") {
    private val prefs = context.getSharedPreferences(name, Context.MODE_PRIVATE)
    private fun string(key: String) = prefs.getString(key, "").orEmpty()
    fun binding(): PushBinding? {
        val user = NotificationDestination.uuid(string("user")) ?: return null
        val binding = NotificationDestination.uuid(string("binding")) ?: return null
        return PushBinding(user, binding, string("installation"), string("device").ifBlank { null })
    }
    fun optedIn(user: String) = prefs.getBoolean("enabled:$user", false)
    fun enabled() = binding()?.let { optedIn(it.userId) } == true
    fun token() = string("token")
    fun token(value: String) { prefs.edit().putString("token", value).apply() }
    fun registered() = prefs.getBoolean("registered", false)
    fun deviceId(id: String, expected: PushBinding, expectedToken: String = token()): Boolean = synchronized(PushNotifications.lock) {
        if (binding() != expected || token() != expectedToken || !enabled()) return false
        prefs.edit().putString("device", id).putBoolean("registered", true).commit()
        true
    }
    fun bind(user: String, enable: Boolean = optedIn(user)): PushBinding? = synchronized(PushNotifications.lock) {
        if (binding()?.userId != user) clearBinding()
        if (!enable) return null
        binding()?.let { return it }
        val installation = string("installation").ifBlank { UUID.randomUUID().toString() }
        prefs.edit().putString("installation", installation).putString("user", user)
            .putString("binding", UUID.randomUUID().toString()).putBoolean("enabled:$user", true).putBoolean("registered", false).commit()
        binding()
    }
    fun disable(user: String) = synchronized(PushNotifications.lock) {
        prefs.edit().putBoolean("enabled:$user", false).commit()
        clearBinding()
    }
    fun clearBinding(): PushBinding? = synchronized(PushNotifications.lock) {
        val old = binding()
        prefs.edit().remove("user").remove("binding").remove("device").remove("seen").putBoolean("registered", false).commit()
        old
    }
    fun accepts(notice: PushNotice): Boolean = binding()?.let { enabled() && it.userId == notice.userId && it.bindingId == notice.bindingId } == true
    fun recordRead(ids: Collection<String>) {
        val seen = string("seen").split(',').filter { it.isNotBlank() }
        prefs.edit().putString("seen", (seen + ids).distinct().takeLast(500).joinToString(",")).commit()
    }
    fun record(id: String): Boolean {
        val seen = string("seen").split(',').filter { it.isNotBlank() }
        if (id in seen) return false
        prefs.edit().putString("seen", (seen.takeLast(499) + id).joinToString(",")).commit()
        return true
    }
}

internal object PushNotifications {
    val lock = Any()
    val registration = Mutex()
    const val EXTRA = "connect.notification"
    private const val WORK = "connect-push-registration"
    val configured get() = listOf(BuildConfig.FIREBASE_APP_ID, BuildConfig.FIREBASE_API_KEY, BuildConfig.FIREBASE_PROJECT_ID, BuildConfig.FIREBASE_SENDER_ID).all { it.isNotBlank() }
    @Volatile var activeConversation: String? = null
    @Volatile var activePersonal: String? = null
    @Volatile var activeCompany: String? = null
    @Volatile var foreground = false
    var obscured by mutableStateOf(false)

    fun initialize(context: Context) {
        channels(context)
        if (!configured) return
        runCatching {
            if (FirebaseApp.getApps(context).isEmpty())
                FirebaseApp.initializeApp(context, FirebaseOptions.Builder().setApplicationId(BuildConfig.FIREBASE_APP_ID)
                    .setApiKey(BuildConfig.FIREBASE_API_KEY).setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                    .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID).build())
        }
    }
    fun available(context: Context) = configured && GoogleApiAvailabilityLight.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS
    fun permitted(context: Context) = NotificationManagerCompat.from(context).areNotificationsEnabled() &&
        (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
    fun channels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        listOf("messages" to "Messages", "activity" to "Company activity", "updates" to "App updates").forEach { (id, name) ->
            manager.createNotificationChannel(NotificationChannel("connect_$id", name, if (id == "messages") NotificationManager.IMPORTANCE_HIGH else NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = when (id) { "messages" -> "New messages and conversation requests"; "updates" -> "A new version of Connect is available"; else -> "Comments, replies, reactions, and your network" }
                lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
            })
        }
    }
    fun session(context: Context, user: String?) {
        val store = PushDeviceStore(context)
        if (store.binding()?.userId != user) {
            store.clearBinding()
            NotificationManagerCompat.from(context).cancelAll()
        }
        if (user != null && store.optedIn(user) && available(context) && permitted(context)) {
            store.bind(user)
            refreshToken(context)
        }
    }
    fun enable(context: Context, user: String) {
        if (!available(context) || !permitted(context)) return
        PushDeviceStore(context).bind(user, true)
        refreshToken(context)
    }
    fun refreshToken(context: Context) {
        if (!configured || !PushDeviceStore(context).enabled()) return
        FirebaseMessaging.getInstance().isAutoInitEnabled = true
        FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
            PushDeviceStore(context).token(token)
            schedule(context)
        }
    }
    fun clear(context: Context, optOut: Boolean = false): PushBinding? {
        val store = PushDeviceStore(context)
        val old = store.binding()
        if (optOut && old != null) store.disable(old.userId) else store.clearBinding()
        WorkManager.getInstance(context).cancelUniqueWork(WORK)
        NotificationManagerCompat.from(context).cancelAll()
        activeConversation = null; activePersonal = null; activeCompany = null
        if (configured) runCatching { FirebaseMessaging.getInstance().isAutoInitEnabled = false }
        return old
    }
    fun schedule(context: Context) {
        if (!configured || !PushDeviceStore(context).enabled()) return
        WorkManager.getInstance(context).enqueueUniqueWork(WORK, ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<PushRegistrationWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build())
    }
    fun suppress(notice: PushNotice) = foreground && !obscured && when (notice.destination.route) {
        "conversation" -> notice.companyId == activeCompany && notice.destination.id == activeConversation
        "personal" -> notice.destination.id == activePersonal
        else -> false
    }
    /** Only confirmed reads belonging to the active account may dismiss device alerts. */
    fun clearRead(context: Context, userId: String, ids: Collection<String>) = synchronized(lock) {
        val store = PushDeviceStore(context)
        if (store.binding()?.userId != userId) return@synchronized
        val manager = NotificationManagerCompat.from(context)
        val valid = ids.mapNotNull { NotificationDestination.uuid(it) }.distinct()
        store.recordRead(valid)
        valid.forEach { manager.cancel(it, 0) }
    }
    fun show(context: Context, notice: PushNotice): Boolean = synchronized(lock) {
        val store = PushDeviceStore(context)
        if (!store.accepts(notice) || !permitted(context) || suppress(notice) || !store.record(notice.id)) return false
        channels(context)
        val channel = when (notice.destination.route) { "conversation", "personal", "messages", "companyChat" -> "messages"; "updates" -> "updates"; else -> "activity" }
        val intent = Intent(context, MainActivity::class.java).setAction("connect.notification.${notice.id}")
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra(EXTRA, notice.json().toString())
        val tap = PendingIntent.getActivity(context, notice.id.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, "connect_$channel")
            .setSmallIcon(R.drawable.ic_notification).setColor(0xffff6b0b.toInt())
            .setContentTitle(notice.title).setContentText(notice.body).setStyle(NotificationCompat.BigTextStyle().bigText(notice.body))
            .setContentIntent(tap).setAutoCancel(true).setOnlyAlertOnce(true)
            .setCategory(if (channel == "messages") NotificationCompat.CATEGORY_MESSAGE else NotificationCompat.CATEGORY_SOCIAL)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(NotificationCompat.Builder(context, "connect_$channel").setSmallIcon(R.drawable.ic_notification).setContentTitle("Connect").setContentText("You have a new notification").build())
            .build()
        try {
            NotificationManagerCompat.from(context).notify(notice.id, 0, notification)
            true
        } catch (_: SecurityException) { false }
    }
}

class ConnectMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        PushDeviceStore(this).token(token)
        PushNotifications.schedule(this)
    }
    override fun onMessageReceived(message: RemoteMessage) {
        // Data-only payloads allow this check even when the app process was not running.
        PushNotice.parse(message.data)?.let { PushNotifications.show(this, it) }
    }
}

class PushRegistrationWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result = PushNotifications.registration.withLock { withContext(Dispatchers.IO) {
        val store = PushDeviceStore(applicationContext)
        val binding = store.binding() ?: return@withContext Result.success()
        if (!store.enabled() || !PushNotifications.permitted(applicationContext) || !PushNotifications.configured) return@withContext Result.success()
        val token = store.token().takeIf { it.isNotBlank() } ?: return@withContext Result.success()
        val cookie = SessionStore(applicationContext).read() ?: return@withContext Result.success()
        CommunityClient(BuildConfig.API_URL, applicationContext.filesDir.resolve("push-cache.sqlite").path, BuildConfig.DEBUG).use { client ->
            try {
                client.restoreSession(cookie)
                val session = JSONObject(client.get("/session"))
                if (session.optJSONObject("user")?.text("id") != binding.userId) return@withContext Result.success()
                val config = JSONObject(client.get("/notifications/config"))
                if (config.optJSONObject("fcm")?.optBoolean("enabled") != true) return@withContext Result.success()
                if (store.binding() != binding || store.token() != token || !store.enabled()) return@withContext Result.success()
                val body = JSONObject().put("platform", "android").put("token", token)
                    .put("installationId", binding.installationId).put("bindingId", binding.bindingId)
                    .put("appVersionCode", BuildConfig.VERSION_CODE).put("appVersionName", BuildConfig.VERSION_NAME)
                val response = JSONObject(client.postJson("/notifications/devices", body.toString()))
                val id = NotificationDestination.uuid(response.text("id")) ?: return@withContext Result.failure()
                if (!store.deviceId(id, binding, token)) runCatching { client.requestJson("DELETE", "/notifications/devices/$id", "{}") }
                Result.success()
            } catch (failure: CancellationException) {
                throw failure
            } catch (failure: Exception) {
                if (store.binding() != binding) Result.success()
                else if (failure is com.sunhub.core.CoreException.Api && failure.status.toInt() in listOf(401, 403)) Result.failure()
                else Result.retry()
            }
        }
    }
}
}
