package com.sunhub.community

import android.Manifest
import android.app.NotificationManager
import android.content.Intent
import android.os.Build
import androidx.test.platform.app.InstrumentationRegistry
import java.util.UUID
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class PushNotificationsTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val user = UUID.randomUUID().toString()
    private val otherUser = UUID.randomUUID().toString()
    private val company = UUID.randomUUID().toString()
    private val conversation = UUID.randomUUID().toString()
    private val store get() = PushDeviceStore(context)
    private fun notice(binding: PushBinding, url: String = "/messages?conversation=$conversation", id: String = UUID.randomUUID().toString()) = PushNotice.parse(mapOf(
        "id" to id, "recipientUserId" to binding.userId, "bindingId" to binding.bindingId,
        "type" to "message", "title" to "A new message", "body" to "Open Connect to read it.", "url" to url, "companyId" to company,
    ))!!

    @Before fun before() {
        check(BuildConfig.API_URL == "http://10.0.2.2:4102") { "Push tests use an isolated local Android build." }
        context.getSharedPreferences("connect-push", 0).edit().clear().commit()
        PushNotifications.foreground = false; PushNotifications.obscured = false
        PushNotifications.activeConversation = null; PushNotifications.activePersonal = null; PushNotifications.activeCompany = null
        if (Build.VERSION.SDK_INT >= 33) instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
        PushNotifications.channels(context)
    }
    @After fun after() {
        PushNotifications.clear(context)
        context.getSharedPreferences("connect-push", 0).edit().clear().commit()
    }

    @Test fun routesAreStrictlySameOriginAndAllowlisted() {
        val origin = "https://connect.sunhubapp.com"
        assertEquals(NotificationDestination("conversation", conversation), NotificationDestination.parse("/messages?conversation=$conversation", origin))
        assertEquals(NotificationDestination("personal", conversation), NotificationDestination.parse("$origin/messages?personal=$conversation", origin))
        assertEquals(NotificationDestination("post", conversation, company), NotificationDestination.parse("/posts/$conversation?comment=$company", origin))
        assertEquals(NotificationDestination("companyChat", company), NotificationDestination.parse("/messages?company=$company", origin))
        assertEquals("updates", NotificationDestination.parse("/account/updates", origin)?.route)
        assertEquals("invite", NotificationDestination.parse("/join/solar-team", origin)?.route)
        listOf("https://evil.test/messages", "//evil.test/messages", "http://connect.sunhubapp.com/messages", "$origin:8443/messages", "/messages?conversation=$conversation&conversation=$conversation", "/messages?conversation=$conversation&token=secret", "/posts/%2e%2e", "/posts/$conversation#token", "/account/delete", "/messages?personal=wrong", "/messages\\evil", "javascript:alert(1)").forEach { assertNull(it, NotificationDestination.parse(it, origin)) }
    }

    @Test fun dataMustMatchCurrentUserAndUnpredictableBinding() {
        val first = store.bind(user, true)!!
        val payload = notice(first)
        assertTrue(store.accepts(payload))
        assertEquals(payload, PushNotice.parse(payload.json()))
        assertFalse(store.accepts(payload.copy(userId = otherUser)))
        assertFalse(store.accepts(payload.copy(bindingId = UUID.randomUUID().toString())))
        store.clearBinding()
        assertFalse(store.accepts(payload))
        val restored = store.bind(user, true)!!
        assertNotEquals(first.bindingId, restored.bindingId)
        assertEquals(first.installationId, restored.installationId)
        assertFalse(store.accepts(payload))
        store.bind(otherUser, true)
        assertFalse(store.accepts(notice(restored)))
    }

    @Test fun lateRegistrationCannotRestoreLoggedOutOrRotatedDevice() {
        val binding = store.bind(user, true)!!
        store.token("old-token")
        store.token("new-token")
        assertFalse(store.deviceId(UUID.randomUUID().toString(), binding, "old-token"))
        val device = UUID.randomUUID().toString()
        assertTrue(store.deviceId(device, binding, "new-token"))
        val registered = store.binding()!!
        store.clearBinding()
        assertFalse(store.deviceId(device, registered, "new-token"))
        assertNull(store.binding())
        assertFalse(store.registered())
    }

    @Test fun activeConversationOnlySuppressesWhenActuallyVisible() {
        val payload = notice(store.bind(user, true)!!)
        PushNotifications.foreground = true; PushNotifications.activeCompany = company; PushNotifications.activeConversation = conversation
        assertTrue(PushNotifications.suppress(payload))
        PushNotifications.obscured = true
        assertFalse(PushNotifications.suppress(payload))
        PushNotifications.obscured = false; PushNotifications.activeCompany = UUID.randomUUID().toString()
        assertFalse(PushNotifications.suppress(payload))
        PushNotifications.activePersonal = conversation
        assertTrue(PushNotifications.suppress(notice(store.binding()!!, "/messages?personal=$conversation")))
        PushNotifications.foreground = false
        assertFalse(PushNotifications.suppress(payload))
    }

    @Test fun backgroundDataCreatesPrivateNotificationAndLogoutRemovesIt() {
        val payload = notice(store.bind(user, true)!!)
        assertTrue(PushNotifications.show(context, payload))
        assertFalse(PushNotifications.show(context, payload))
        val manager = context.getSystemService(NotificationManager::class.java)
        val deadline = System.currentTimeMillis() + 3000
        while (manager.activeNotifications.none { it.tag == payload.id } && System.currentTimeMillis() < deadline) Thread.sleep(25)
        val notification = manager.activeNotifications.single { it.tag == payload.id }.notification
        assertEquals("connect_messages", notification.channelId)
        assertEquals(android.app.Notification.VISIBILITY_PRIVATE, notification.visibility)
        assertEquals("You have a new notification", notification.publicVersion.extras.getString("android.text"))
        assertTrue(notification.contentIntent.isImmutable)
        PushNotifications.clear(context)
        assertFalse(PushNotifications.show(context, payload.copy(id = UUID.randomUUID().toString())))
        val cancelledBy = System.currentTimeMillis() + 3000
        while (manager.activeNotifications.any { it.tag == payload.id } && System.currentTimeMillis() < cancelledBy) Thread.sleep(25)
        assertFalse(manager.activeNotifications.any { it.tag == payload.id })
    }

    @Test fun confirmedReadDismissesTrayAndRejectsLateDeliveryWithoutAffectingAnotherAccount() {
        val binding = store.bind(user, true)!!
        val payload = notice(binding)
        val delayed = notice(binding)
        assertTrue(PushNotifications.show(context, payload))
        val manager = context.getSystemService(NotificationManager::class.java)
        val deadline = System.currentTimeMillis() + 3000
        while (manager.activeNotifications.none { it.tag == payload.id } && System.currentTimeMillis() < deadline) Thread.sleep(25)
        PushNotifications.clearRead(context, otherUser, listOf(payload.id, delayed.id))
        assertTrue(manager.activeNotifications.any { it.tag == payload.id })
        PushNotifications.clearRead(context, user, listOf(payload.id, delayed.id))
        val cancelledBy = System.currentTimeMillis() + 3000
        while (manager.activeNotifications.any { it.tag == payload.id } && System.currentTimeMillis() < cancelledBy) Thread.sleep(25)
        assertFalse(manager.activeNotifications.any { it.tag == payload.id })
        assertFalse(PushNotifications.show(context, delayed))
        assertFalse(PushNotifications.show(context, payload))
    }

    @Test fun optingOutRemainsOffAfterSessionRestore() {
        val payload = notice(store.bind(user, true)!!)
        PushNotifications.clear(context, optOut = true)
        assertFalse(store.optedIn(user))
        PushNotifications.session(context, user)
        assertNull(store.binding())
        assertFalse(PushNotifications.show(context, payload))
    }
}
