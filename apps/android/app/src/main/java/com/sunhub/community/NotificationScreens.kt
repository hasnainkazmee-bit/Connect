package com.sunhub.community

import android.Manifest
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

@Composable
internal fun NotificationsScreen(model: CommunityModel, close: () -> Unit, open: (JSONObject) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current
    val user = model.session?.optJSONObject("user")?.text("id").orEmpty()
    var settings by remember { mutableStateOf(false) }
    var revision by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var older by remember(user) { mutableStateOf(emptyList<JSONObject>()) }
    var cursor by remember(user) { mutableStateOf<String?>(null) }
    val device = remember(user, revision) { PushDeviceStore(context) }
    val enabled = device.enabled() && PushNotifications.permitted(context)
    val config = model.pages["/notifications/config"]
    val providerReady = config?.optJSONObject("fcm")?.optBoolean("enabled") == true
    val appReady = PushNotifications.available(context)
    val data = model.pages["/notifications"]
    val notifications = (data?.optJSONArray("notifications").objects() + older).distinctBy { it.text("id") }
    val preferences = model.pages["/notifications/preferences"] ?: JSONObject()
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted && model.session?.optJSONObject("user")?.text("id") == user) PushNotifications.enable(context, user)
        revision++
    }
    LaunchedEffect(user) { model.refreshNotifications(refreshSettings = true) }
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) revision++ }
        lifecycle.lifecycle.addObserver(observer)
        onDispose { lifecycle.lifecycle.removeObserver(observer) }
    }
    fun settingsIntent() = context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName))
    fun enable() {
        if (!appReady || !providerReady) return
        if (Build.VERSION.SDK_INT >= 33 && !PushNotifications.permitted(context)) {
            val prefs = context.getSharedPreferences("connect-push-permission", 0)
            if (prefs.getBoolean("asked", false)) settingsIntent()
            else {
                prefs.edit().putBoolean("asked", true).apply()
                permission.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        } else if (!PushNotifications.permitted(context)) settingsIntent()
        else { PushNotifications.enable(context, user); revision++ }
    }
    WorkSheet(model, if (settings) "Notification settings" else "Notifications", close) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(if (settings) "Stay in the loop" else "Your activity", style = MaterialTheme.typography.titleMedium)
            IconButton(onClick = { settings = !settings }) { Icon(if (settings) Icons.Outlined.Notifications else Icons.Outlined.Settings, if (settings) "View notifications" else "Notification settings") }
        }
        if (!enabled || settings) {
            Surface(color = Pale, shape = ConnectCardShape, modifier = Modifier.fillMaxWidth().testTag("push-permission-card")) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(if (enabled) "Notifications are on" else "Don’t miss a conversation", style = MaterialTheme.typography.titleMedium)
                    Text(when {
                        !PushNotifications.configured -> "Push notifications aren’t configured in this build yet. Your activity is still available here."
                        !appReady -> "Push notifications need Google Play services on this device."
                        !providerReady -> "Push notifications aren’t available yet. Your activity is still available here."
                        enabled -> "Choose what reaches you. Message previews are hidden by default."
                        else -> "Get messages, replies, and app updates even when Connect is closed."
                    }, color = Muted, style = MaterialTheme.typography.bodyMedium)
                    if (!enabled && appReady && providerReady) ConnectButton(onClick = ::enable) { Text("Enable notifications") }
                    if (enabled) {
                        TextButton(onClick = { model.disablePush(); revision++ }) { Text("Turn off on this device") }
                        TextButton(onClick = ::settingsIntent) { Text("Android notification settings") }
                    }
                }
            }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (settings) {
            listOf("messages" to "Messages", "social" to "Comments, replies & reactions", "requests" to "Connection requests", "team" to "Team invitations", "updates" to "App updates", "previews" to "Show message previews").forEach { (key, title) ->
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(title, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                    Switch(preferences.optBoolean(key, key != "previews"), modifier = Modifier.testTag("notification-preference-$key").semantics { contentDescription = title }, enabled = !loading, onCheckedChange = { value ->
                        loading = true; error = null
                        scope.launch {
                            try { model.pages["/notifications/preferences"] = model.jsonRequest("PATCH", "/notifications/preferences", JSONObject().put(key, value)) }
                            catch (_: Exception) { error = "Couldn’t save this preference. Try again." }
                            finally { loading = false }
                        }
                    })
                }
            }
        } else {
            notifications.forEach { item ->
                val unread = item.text("id") !in model.readNotificationIds && (item.isNull("read_at") || item.text("read_at").isBlank())
                Row(Modifier.fillMaxWidth().testTag("notification-${item.text("id")}").semantics { stateDescription = if (unread) "Unread" else "Read" }.notificationSeenAfterDwell(item.text("id"), unread) { model.markNotificationsSeen(listOf(it)) }.background(if (unread) Pale else androidx.compose.ui.graphics.Color.Transparent, ConnectCardShape)
                    .clickable { open(item) }.padding(14.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(when (item.text("category")) { "messages" -> Icons.Outlined.ChatBubbleOutline; "updates" -> Icons.Outlined.SystemUpdate; else -> Icons.Outlined.NotificationsNone }, null, tint = Muted)
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(item.text("title").ifBlank { "Connect" }, fontWeight = if (unread) FontWeight.SemiBold else FontWeight.Normal)
                        Text(item.text("text"), color = Muted, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
            if (notifications.isEmpty()) Text("Messages and activity from your network will appear here.", color = Muted)
            val next = cursor ?: data?.optString("nextCursor")?.takeUnless { it.isBlank() || it == "null" }
            if (next != null && next != "end") TextButton(enabled = !loading, onClick = {
                loading = true
                scope.launch {
                    try {
                        val page = model.fetchJson("/notifications?before=${query(next)}")
                        if (model.session?.optJSONObject("user")?.text("id") == user) {
                            model.acceptReadNotifications(page.optJSONArray("notifications").objects())
                            older = older + page.optJSONArray("notifications").objects()
                            cursor = page.optString("nextCursor").takeUnless { it.isBlank() || it == "null" } ?: "end"
                        }
                    } catch (_: Exception) { error = "Couldn’t load older notifications." }
                    finally { loading = false }
                }
            }) { Text(if (loading) "Loading…" else "Older notifications") }
        }
    }
}
