package com.sunhub.community

import android.Manifest
import android.os.Build
import androidx.test.platform.app.InstrumentationRegistry
import com.google.android.gms.tasks.Tasks
import com.google.firebase.messaging.FirebaseMessaging
import com.sunhub.core.CommunityClient
import java.util.UUID
import java.util.concurrent.TimeUnit
import org.json.JSONObject
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Explicit opt-in live provider probe. Writes no account or production API data. */
class FcmDeviceProbeTest {
    @Test fun prepareSyntheticClosedAppDelivery() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assumeTrue(InstrumentationRegistry.getArguments().getString("liveFirebase") == "true")
        val context = instrumentation.targetContext
        check(BuildConfig.API_URL == "http://10.0.2.2:4102" && PushNotifications.available(context))
        if (Build.VERSION.SDK_INT >= 33) instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
        val testClient = CommunityClient(BuildConfig.API_URL, ":memory:", true)
        val suffix = UUID.randomUUID().toString()
        val session = JSONObject(testClient.postJson("/auth/register", JSONObject().put("name", "Local FCM probe")
            .put("companyName", "Local FCM probe $suffix").put("email", "fcm-$suffix@native.test").put("password", UUID.randomUUID().toString() + "Aa1!").toString()))
        SessionStore(context).save(testClient.sessionCookie())
        val binding = PushDeviceStore(context).bind(session.getJSONObject("user").getString("id"), true)!!
        FirebaseMessaging.getInstance().isAutoInitEnabled = true
        val token = Tasks.await(FirebaseMessaging.getInstance().token, 45, TimeUnit.SECONDS)
        PushDeviceStore(context).token(token)
        val registered = JSONObject(testClient.postJson("/notifications/devices", JSONObject().put("platform", "android").put("token", token)
            .put("installationId", binding.installationId).put("bindingId", binding.bindingId).put("appVersionCode", BuildConfig.VERSION_CODE).toString()))
        check(PushDeviceStore(context).deviceId(registered.getString("id"), binding, token))
        testClient.destroy()
        val payload = JSONObject().put("token", token).put("recipientUserId", binding.userId).put("bindingId", binding.bindingId)
            .put("id", UUID.randomUUID().toString()).put("type", "app_update").put("title", "Connect notification check")
            .put("body", "Closed-app delivery is working.").put("url", "/account/updates").put("companyId", "")
        context.filesDir.resolve("fcm-probe.json").writeText(payload.toString())
        // Test process exits; the host backgrounds/kills the process (not force-stop),
        // then sends this synthetic data-only payload using the real Firebase provider.
    }
}
