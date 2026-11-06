package com.sunhub.community

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

/** Foreground inbox invalidation only. Closed-app delivery belongs exclusively to FCM. */
internal object NotificationEvents {
    private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(35, TimeUnit.SECONDS).build()

    suspend fun listen(origin: String, cookie: String, changed: () -> Unit): Boolean = suspendCancellableCoroutine { continuation ->
        val call = client.newCall(Request.Builder().url("${origin.trimEnd('/')}/api/notifications/events")
            .header("Cookie", cookie).header("Accept", "text/event-stream").build())
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (continuation.isActive) continuation.resume(true)
            }
            override fun onResponse(call: Call, response: Response) {
                var reconnect = response.code !in listOf(401, 403)
                response.use {
                    if (response.isSuccessful && response.header("Content-Type").orEmpty().startsWith("text/event-stream")) {
                        try {
                            response.body?.source()?.let { source ->
                                while (continuation.isActive) {
                                    val line = source.readUtf8Line() ?: break
                                    if (line == "event: changed") changed()
                                }
                            }
                        } catch (_: IOException) { /* Network changes reconnect while visible. */ }
                    }
                }
                if (continuation.isActive) continuation.resume(reconnect)
            }
        })
    }
}
