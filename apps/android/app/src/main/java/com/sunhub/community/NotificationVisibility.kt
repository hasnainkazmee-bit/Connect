package com.sunhub.community

import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.delay

/** Clipped scroll bounds, not composition, determine whether an inbox row was seen. */
internal fun Modifier.notificationSeenAfterDwell(id: String, enabled: Boolean, seen: (String) -> Unit): Modifier = composed {
    var visible by remember(id) { mutableStateOf(false) }
    val lifecycle by LocalLifecycleOwner.current.lifecycle.currentStateFlow.collectAsState()
    val callback by rememberUpdatedState(seen)
    LaunchedEffect(id, enabled, visible, lifecycle) {
        if (enabled && visible && lifecycle.isAtLeast(Lifecycle.State.RESUMED)) {
            delay(1_000)
            callback(id)
        }
    }
    onGloballyPositioned { coordinates ->
        val bounds = coordinates.boundsInWindow()
        visible = coordinates.size.height > 0 && coordinates.size.width > 0 &&
            bounds.height >= coordinates.size.height * .6f && bounds.width >= coordinates.size.width * .6f
    }
}

@Composable
internal fun NotificationContextSeen(model: CommunityModel, kind: String, id: String?, visible: Boolean = true) {
    val lifecycle by LocalLifecycleOwner.current.lifecycle.currentStateFlow.collectAsState()
    val user = model.session?.optJSONObject("user")?.text("id")
    val unread = model.pages["/notifications"]?.optInt("unread") ?: 0
    LaunchedEffect(kind, id, user, unread, visible, lifecycle) {
        if (user != null && NotificationDestination.uuid(id) != null && visible && lifecycle.isAtLeast(Lifecycle.State.RESUMED)) {
            delay(1_000)
            model.markNotificationContextRead(kind, id!!)
        }
    }
}
