package com.sunhub.community

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.util.Collections

class NotificationVisibilityTest {
    @get:Rule val ui = createComposeRule()

    @Test fun dwellReadsOnlyVisibleRows_andScrollingRevealsOthers() {
        val seen = Collections.synchronizedSet(mutableSetOf<String>())
        ui.setContent {
            Column(Modifier.width(300.dp).height(170.dp).verticalScroll(rememberScrollState()).testTag("viewport")) {
                repeat(12) { index ->
                    Box(Modifier.fillMaxWidth().height(80.dp).notificationSeenAfterDwell("row-$index", true) { seen.add(it) }.testTag("row-$index")) { Text("Notification $index") }
                }
            }
        }
        ui.waitUntil(5_000) { "row-0" in seen && "row-1" in seen }
        assertFalse("Partially clipped row must not count as viewed", "row-2" in seen)
        assertFalse("Composed off-screen row must stay unread", "row-11" in seen)
        ui.onNodeWithTag("row-11").performScrollTo()
        ui.waitUntil(5_000) { "row-11" in seen }
        assertFalse("Passing rows while scrolling is not a one-second dwell", "row-6" in seen)
    }

    @Test fun briefVisibilityDoesNotMarkRead() {
        val seen = Collections.synchronizedSet(mutableSetOf<String>())
        ui.mainClock.autoAdvance = false
        ui.setContent { Box(Modifier.size(120.dp).notificationSeenAfterDwell("brief", true) { seen.add(it) }) }
        ui.mainClock.advanceTimeBy(600)
        assertFalse("A quick glance should not clear unread", "brief" in seen)
        ui.mainClock.advanceTimeBy(600)
        ui.waitForIdle()
        assertTrue("A full visible dwell should clear unread", "brief" in seen)
    }
}
