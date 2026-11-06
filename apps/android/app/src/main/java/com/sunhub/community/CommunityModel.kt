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
    private val sunhubBrowser = SunhubBrowserSignIn(application, baseUrl)
    var sunhubEnabled by mutableStateOf(false)
        private set

    var sunhubWaiting by mutableStateOf(false)
        private set

    var sunhubReturnReady by mutableStateOf(false)
        private set

    fun acknowledgeSunhubReturn() {
        sunhubReturnReady = false
    }

    private var sunhubConfigJob: Job? = null
    private var sunhubCallbackJob: Job? = null
    private var sunhubLaunchJob: Job? = null
    private var client: CommunityClient? = null
    val pages = mutableStateMapOf<String, JSONObject>()
    private val loads = mutableMapOf<String, Job>()
    private val writes = Mutex()
    @Volatile private var epoch = 0
    @Volatile private var loggingOut = false
    private var foreground = false
    private var watcher: EventWatch? = null
    private var watchJob: Job? = null
    private var pollJob: Job? = null
    private var sessionJob: Job? = null
    private var refreshJob: Job? = null
    private var notificationEvents: Job? = null
    private var notificationRefresh: Job? = null
    private var notificationRefreshAgain = false
    private val seenNotifications = linkedSetOf<String>()
    internal val readNotificationIds = mutableStateMapOf<String, Boolean>()
    private var readNotificationsJob: Job? = null
    var session by mutableStateOf<JSONObject?>(null)
        private set

    var sessionReady by mutableStateOf(false)
        private set
    internal var notificationTap by mutableStateOf<PushNotice?>(null)
        private set

    fun handleNotificationIntent(intent: Intent?) {
        val raw = intent?.getStringExtra(PushNotifications.EXTRA) ?: return
        intent.removeExtra(PushNotifications.EXTRA)
        if (raw.length > 4096) return
        val notice = runCatching { PushNotice.parse(JSONObject(raw)) }.getOrNull() ?: return
        if (PushDeviceStore(getApplication()).accepts(notice)) notificationTap = notice
    }
    fun consumeNotificationTap() { notificationTap = null }

    private fun persistSession(enablePush: Boolean = false) {
        val captured = epoch
        val userId = session?.optJSONObject("user")?.text("id")
        val cookie = client?.sessionCookie() ?: return
        viewModelScope.launch(Dispatchers.IO) {
            synchronized(PushNotifications.lock) {
                if (!loggingOut && epoch == captured && session?.optJSONObject("user")?.text("id") == userId) {
                    store.save(cookie)
                    if (enablePush) PushNotifications.session(getApplication(), userId)
                }
            }
        }
    }

    private fun verifiedSession(value: JSONObject) {
        sessionReady = true
        val userId = value.optJSONObject("user")?.text("id")
        // Clear another account's binding before asynchronous persistence or FCM delivery.
        if (PushDeviceStore(getApplication()).binding()?.userId != userId) PushNotifications.clear(getApplication())
        persistSession(enablePush = true)
        refreshNotifications()
    }

    fun refreshNotifications(refreshSettings: Boolean = false) {
        if (!signedIn || client == null) return
        if (refreshSettings) pages.remove("/notifications/config")
        notificationRefreshAgain = true
        if (notificationRefresh?.isActive == true) return
        val captured = epoch
        notificationRefresh = viewModelScope.launch {
            do {
                notificationRefreshAgain = false
                val paths = listOf("/notifications") + listOf("/notifications/config", "/notifications/preferences").filter { !pages.containsKey(it) }
                for (path in paths) {
                    try {
                        val value = fetchJson(path)
                        if (epoch == captured) {
                            pages[path] = value
                            if (path == "/notifications") acceptReadNotifications(value.optJSONArray("notifications").objects())
                        }
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (_: Exception) { /* Existing activity stays visible while offline. */ }
                }
            } while (notificationRefreshAgain && epoch == captured)
        }
    }

    internal fun acceptReadNotifications(rows: List<JSONObject>) {
        confirmNotificationsRead(rows.filter { !it.isNull("read_at") && it.text("read_at").isNotBlank() }.map { it.text("id") })
    }

    private fun confirmNotificationsRead(ids: Collection<String>) {
        val userId = session?.optJSONObject("user")?.text("id") ?: return
        val valid = ids.mapNotNull { NotificationDestination.uuid(it) }
        valid.forEach { readNotificationIds[it] = true }
        PushNotifications.clearRead(getApplication(), userId, valid)
    }

    internal fun markNotificationsSeen(ids: Collection<String>) {
        if (!signedIn) return
        seenNotifications.addAll(ids.mapNotNull { NotificationDestination.uuid(it) }.filter { it !in readNotificationIds })
        if (readNotificationsJob?.isActive == true) return
        val captured = epoch
        readNotificationsJob = viewModelScope.launch {
            while (seenNotifications.isNotEmpty() && captured == epoch) {
                delay(180)
                val batch = seenNotifications.take(100)
                try {
                    jsonRequest("POST", "/notifications/read", JSONObject().put("ids", JSONArray(batch)))
                    if (captured == epoch) { seenNotifications.removeAll(batch.toSet()); confirmNotificationsRead(batch); refreshNotifications() }
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { delay(5_000) }
            }
        }
    }

    internal fun markNotificationContextRead(kind: String, id: String) {
        if (!signedIn || kind !in setOf("company_conversation", "personal_conversation", "post") || NotificationDestination.uuid(id) == null) return
        val captured = epoch
        viewModelScope.launch {
            try {
                val result = jsonRequest("POST", "/notifications/read-context", JSONObject().put("kind", kind).put("id", id))
                if (captured == epoch) { confirmNotificationsRead(result.optJSONArray("ids").strings()); refreshNotifications() }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { /* Reopening or the next live change retries without losing content. */ }
        }
    }

    fun disablePush() {
        val old = PushNotifications.clear(getApplication(), optOut = true)
        old?.deviceId?.let { id -> viewModelScope.launch { runCatching { jsonRequest("DELETE", "/notifications/devices/$id") } } }
    }

    internal suspend fun openNotification(destination: NotificationDestination, companyId: String?): JSONObject? {
        val capturedUser = session?.optJSONObject("user")?.text("id") ?: return null
        if (companyId != null && companyId != company?.text("id") && !individual) {
            if (companies.none { it.text("id") == companyId }) error("You no longer have access to this company.")
            val updated = writes.withLock { jsonRequest("POST", "/session/company", JSONObject().put("companyId", companyId)) }
            if (session?.optJSONObject("user")?.text("id") != capturedUser) return null
            resetContent(); session = updated; profileId = null; chatCompany = null
            verifiedSession(updated)
        }
        return when (destination.route) {
            "conversation" -> {
                val data = fetchJson("/network")
                if (session?.optJSONObject("user")?.text("id") != capturedUser) return null
                pages["/network"] = data
                selectTab(Tab.Messages)
                data.optJSONArray("connections").objects().find { it.text("id") == destination.id }?.optJSONObject("company")?.let(::chat)
                null
            }
            "companyChat" -> {
                val data = fetchJson("/companies/${destination.id}")
                if (session?.optJSONObject("user")?.text("id") != capturedUser) return null
                pages["/companies/${destination.id}"] = data
                chat(data.getJSONObject("company"))
                null
            }
            "personal" -> {
                val data = fetchJson("/personal-inbox/${destination.id}")
                if (session?.optJSONObject("user")?.text("id") != capturedUser) return null
                selectTab(Tab.Messages)
                pages["/personal-inbox/${destination.id}"] = data
                data.optJSONObject("thread")
            }
            "post" -> fetchJson("/posts/${destination.id}")
            "profile" -> { profile(destination.id!!); null }
            "messages" -> { selectTab(Tab.Messages); null }
            else -> null
        }
    }

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
                verifiedSession(value)
                if (company != null) load("/network")
                load("/feed?scope=all")
            }
            value
                .optString("challengeId")
                .takeIf { it.isNotBlank() && it != "null" }
                ?.let { verificationChallenge = it }
            persistSession()
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

    fun load(path: String, force: Boolean = false): Job? {
        val core = client ?: return null
        if (loads[path]?.isActive == true && !force) return loads[path]
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
        return loads[path]
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
                    verifiedSession(value)
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

    fun loadSunhubConfiguration() {
        sunhubConfigJob?.cancel()
        sunhubConfigJob =
            viewModelScope.launch {
                try {
                    sunhubEnabled = fetchJson("/auth/sunhub/config").optBoolean("enabled", false)
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    sunhubEnabled = false
                }
            }
    }

    fun startSunhubSignIn(intent: String, accountType: String) {
        if (busy || booting || !sunhubEnabled || sunhubLaunchJob?.isActive == true) return
        error = null
        sunhubLaunchJob =
            viewModelScope.launch {
                try {
                    val uri =
                        withContext(Dispatchers.IO) { sunhubBrowser.begin(intent, accountType) }
                    getApplication<Application>()
                        .startActivity(
                            Intent(Intent.ACTION_VIEW, uri)
                                .addCategory(Intent.CATEGORY_BROWSABLE)
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        )
                    sunhubWaiting = true
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    sunhubBrowser.cancel()
                    sunhubWaiting = false
                    error = "Couldn’t open your browser. You can still use your Connect login."
                }
            }
    }

    fun cancelSunhubSignIn() {
        sunhubLaunchJob?.cancel()
        sunhubBrowser.cancel()
        sunhubWaiting = false
    }

    fun handleSunhubCallback(uri: Uri?) {
        if (!sunhubBrowser.isCallback(uri) || sunhubCallbackJob?.isActive == true) return
        sunhubCallbackJob =
            viewModelScope.launch {
                // A browser return may create a fresh Activity before the Rust session client is
                // ready.
                while (booting) delay(25)
                if (client == null) return@launch
                val callbackEpoch = epoch
                when (val result = withContext(Dispatchers.IO) { sunhubBrowser.accept(uri!!) }) {
                    SunhubBrowserSignIn.Callback.Ignore -> Unit
                    is SunhubBrowserSignIn.Callback.Failure -> {
                        sunhubReturnReady = true
                        sunhubWaiting = false
                        error = SunhubBrowserSignIn.message(result.reason)
                    }
                    is SunhubBrowserSignIn.Callback.Exchange -> {
                        sunhubReturnReady = true
                        sunhubWaiting = false
                        // serialize with any in-flight local account action; never drop a valid
                        // return.
                        while (busy) delay(25)
                        if (callbackEpoch != epoch) return@launch
                        mutate(
                            "/auth/sunhub/mobile/exchange",
                            JSONObject().put("code", result.code).put("verifier", result.verifier),
                            ::authenticated,
                        )
                    }
                }
            }
    }

    private fun authenticated(response: JSONObject) {
        resetContent()
        session = response
        verifiedSession(response)
        verificationChallenge =
            response.optString("challengeId").takeUnless { it == "null" }.orEmpty()
        persistSession()
        loadSession()
        if (company != null) load("/network")
        load("/feed?scope=all")
        observe(foreground)
        profileId?.let { profile(it) }
    }

    fun authenticate(
        email: String,
        password: String,
        name: String? = null,
        companyName: String? = null,
        accountType: String = "company",
    ) {
        cancelSunhubSignIn()
        val data = JSONObject().put("email", email.trim()).put("password", password)
        if (name != null)
            data.put("name", name).put("companyName", companyName).put("accountType", accountType)
        mutate(if (name == null) "/auth/login" else "/auth/register", data, ::authenticated)
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
            loggingOut = true
            synchronized(PushNotifications.lock) { PushNotifications.clear(getApplication()) }
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
                loggingOut = false
                busy = false
            }
        }

    private fun resetContent() {
        epoch++
        loads.values.forEach { it.cancel() }
        loads.clear()
        pages.clear()
        notificationRefresh?.cancel()
        notificationEvents?.cancel()
        readNotificationsJob?.cancel()
        seenNotifications.clear()
        readNotificationIds.clear()
    }

    private suspend fun clearLocalSession() {
        PushNotifications.clear(getApplication())
        notificationTap = null
        sessionReady = true
        cancelSunhubSignIn()
        resetContent()
        watchJob?.cancel()
        pollJob?.cancel()
        refreshJob?.cancel()
        watcher?.cancel()
        watcher = null
        withContext(Dispatchers.IO) {
            synchronized(PushNotifications.lock) {
                client?.clearSession()
                store.clear()
            }
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
            var handedOff = false
            try {
                val selected =
                    withContext(Dispatchers.IO) {
                        MediaFiles.import(getApplication(), uris, post, publication)
                    }
                if (capturedEpoch == epoch) {
                    // The import is complete. A callback may immediately start an upload,
                    // which must not be rejected by perform() or reset by our finally block.
                    busy = false
                    handedOff = true
                    done(selected)
                } else withContext(Dispatchers.IO) { MediaFiles.discard(selected) }
            } catch (e: Exception) {
                error = e.message ?: "Couldn’t attach this file."
            } finally {
                if (!handedOff) busy = false
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
        PushNotifications.foreground = active
        if (active && !wasForeground) refreshNotifications()
        watchJob?.cancel()
        pollJob?.cancel()
        watcher?.cancel()
        watcher = null
        if (active && !wasForeground && offline) retryConnection()
        notificationEvents?.cancel()
        if (active && signedIn && client != null && !loggingOut) {
            val observedUser = session?.optJSONObject("user")?.text("id")
            notificationEvents = viewModelScope.launch {
                while (isActive && foreground && session?.optJSONObject("user")?.text("id") == observedUser) {
                    val cookie = client?.sessionCookie().orEmpty()
                    if (cookie.isBlank()) break
                    if (!NotificationEvents.listen(baseUrl, cookie) {
                        viewModelScope.launch { if (foreground && session?.optJSONObject("user")?.text("id") == observedUser) refreshNotifications() }
                    }) break
                    delay(5_000)
                }
            }
        }
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
                                                        refreshNotifications()
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
