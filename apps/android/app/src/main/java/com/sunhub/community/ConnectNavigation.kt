package com.sunhub.community

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Business
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.People
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

internal fun navigationIcon(tab: Tab): ImageVector = when (tab) {
    Tab.Home -> Icons.Outlined.Home
    Tab.Companies -> Icons.Outlined.Business
    Tab.Network -> Icons.Outlined.People
    Tab.Messages -> Icons.AutoMirrored.Outlined.Chat
}

@Composable
internal fun CreatePostButton(onClick: () -> Unit, modifier: Modifier = Modifier) {
    FilledIconButton(
        onClick = onClick,
        modifier = modifier.size(54.dp).testTag("navigation-create"),
        shape = CircleShape,
        colors = IconButtonDefaults.filledIconButtonColors(containerColor = Orange, contentColor = Ink),
    ) {
        Icon(Icons.Outlined.Add, "Create a post", Modifier.size(26.dp))
    }
}

/** A compact floating control, with creation in the same place on every main screen. */
@Composable
internal fun FloatingConnectNavigation(
    tabs: List<Tab>,
    selected: Tab,
    requests: Int,
    select: (Tab) -> Unit,
    create: () -> Unit,
) {
    Box(
        Modifier.fillMaxWidth().background(Pale).navigationBarsPadding()
            .padding(horizontal = 12.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Surface(
            modifier = Modifier.widthIn(max = 560.dp).fillMaxWidth().testTag("floating-navigation"),
            shape = ConnectPillShape,
            color = Color.White,
            border = BorderStroke(1.dp, Ink.copy(alpha = .07f)),
            shadowElevation = 7.dp,
        ) {
            Row(
                Modifier.padding(horizontal = 6.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                    tabs.filter { it == Tab.Home || it == Tab.Companies }.forEach { tab ->
                        NavigationDestination(tab, selected == tab, requests, { select(tab) }, Modifier.weight(1f))
                    }
                }
                CreatePostButton(create)
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                    tabs.filter { it == Tab.Network || it == Tab.Messages }.forEach { tab ->
                        NavigationDestination(tab, selected == tab, requests, { select(tab) }, Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

@Composable
private fun NavigationDestination(
    tab: Tab,
    selected: Boolean,
    requests: Int,
    onClick: () -> Unit,
    modifier: Modifier,
) {
    Column(
        modifier.heightIn(min = 56.dp).clip(ConnectPillShape)
            .background(if (selected) Orange.copy(alpha = .14f) else Color.Transparent)
            .selectable(selected = selected, role = Role.Tab, onClick = onClick)
            .testTag("navigation-${tab.name}").padding(horizontal = 2.dp, vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(3.dp, Alignment.CenterVertically),
    ) {
        if (tab == Tab.Messages && requests > 0) {
            BadgedBox(badge = { Badge { Text(if (requests > 99) "99+" else requests.toString()) } }) {
                Icon(navigationIcon(tab), null, Modifier.size(21.dp), tint = if (selected) Ink else Muted)
            }
        } else Icon(navigationIcon(tab), null, Modifier.size(21.dp), tint = if (selected) Ink else Muted)
        Text(
            tab.name,
            fontSize = 10.sp,
            lineHeight = 12.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
            color = if (selected) Ink else Muted,
        )
    }
}
