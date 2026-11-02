package com.sunhub.community

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import com.sunhub.core.CommunityClient
import kotlin.math.abs
import org.json.JSONObject
import org.junit.Rule
import org.junit.Test

/** Runs only against the isolated API; validates navigation intent and publishing access. */
class FloatingNavigationTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    private fun waitForTag(tag: String) = ui.waitUntil(20_000) {
        ui.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty()
    }

    private fun waitForText(text: String) = ui.waitUntil(20_000) {
        ui.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()
    }

    private fun click(text: String) = ui.onAllNodes(hasText(text) and hasClickAction()).onLast().performClick()

    private fun login(email: String, password: String) {
        waitForText("Work email")
        ui.onNodeWithText("Work email").performTextInput(email)
        ui.onNodeWithText("Password").performTextInput(password)
        click("Sign in")
    }

    private fun signOut() {
        ui.onNodeWithContentDescription("Account and company").performClick()
        click("Sign out")
        waitForText("Sign in")
    }

    @Test
    fun centreCreate_returnsFromSignIn_preservesDestination_andRespectsIndividualAccess() {
        check(BuildConfig.API_URL in setOf("http://10.0.2.2:4101", "http://10.0.2.2:4102")) {
            "Use the isolated test API for navigation instrumentation."
        }
        val suffix = System.currentTimeMillis().toString()
        val password = "ConnectNavigation123!"
        val companyEmail = "navigation$suffix@native.test"
        val personEmail = "person$suffix@native.test"
        val company = CommunityClient(BuildConfig.API_URL, ":memory:", true)
        val person = CommunityClient(BuildConfig.API_URL, ":memory:", true)
        try {
            company.postJson("/auth/register", JSONObject().put("name", "Navigation Owner")
                .put("email", companyEmail).put("password", password).put("companyName", "Navigation Solar $suffix").toString())
            person.postJson("/auth/register", JSONObject().put("name", "Navigation Customer")
                .put("email", personEmail).put("password", password).put("accountType", "individual").toString())

            ui.waitUntil(20_000) {
                ui.onAllNodesWithText("Explore the community first").fetchSemanticsNodes().isNotEmpty() ||
                    ui.onAllNodesWithTag("news-feed").fetchSemanticsNodes().isNotEmpty()
            }
            if (ui.onAllNodesWithText("Explore the community first").fetchSemanticsNodes().isNotEmpty()) click("Explore the community first")
            waitForTag("news-feed")
            if (ui.onAllNodesWithContentDescription("Account and company").fetchSemanticsNodes().isNotEmpty()) signOut()
            waitForTag("floating-navigation")
            ui.onNodeWithTag("navigation-Companies").performClick()
            waitForText("Search companies…")
            ui.onNodeWithTag("navigation-create").performClick()
            login(companyEmail, password)
            waitForTag("publication-composer")
            ui.onNodeWithContentDescription("Close").performClick()
            waitForTag("floating-navigation")
            ui.onNodeWithTag("navigation-Companies").assertIsSelected()

            val capsule = ui.onNodeWithTag("floating-navigation").fetchSemanticsNode().boundsInRoot
            val create = ui.onNodeWithTag("navigation-create").fetchSemanticsNode().boundsInRoot
            check(abs(capsule.center.x - create.center.x) <= 2f) { "Create must stay centred in the floating capsule." }
            ui.onNodeWithTag("navigation-create").assertWidthIsAtLeast(48.dp).assertHeightIsAtLeast(48.dp)
            for (tab in listOf("Network", "Messages")) {
                ui.onNodeWithTag("navigation-$tab").performClick()
                ui.onNodeWithTag("navigation-$tab").assertIsSelected()
                ui.onNodeWithTag("navigation-create").performClick()
                waitForTag("publication-composer")
                ui.onNodeWithContentDescription("Close").performClick()
                waitForTag("floating-navigation")
                ui.onNodeWithTag("navigation-$tab").assertIsSelected()
            }
            signOut()
            ui.onNodeWithTag("navigation-create").performClick()
            login(personEmail, password)
            waitForText("Publishing with your company")
            ui.onNodeWithTag("publication-composer").assertDoesNotExist()
            click("Got it")
            ui.onNodeWithTag("navigation-Network").assertDoesNotExist()
            ui.onNodeWithTag("navigation-create").performClick()
            waitForText("Publishing with your company")
            ui.onNodeWithTag("publication-composer").assertDoesNotExist()
            click("Got it")
            signOut()
        } finally {
            company.destroy()
            person.destroy()
        }
    }
}
