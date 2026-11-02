package com.sunhub.community

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject

@Composable
internal fun WelcomeScreen(onCreate: () -> Unit, onSignIn: () -> Unit, onBrowse: () -> Unit) {
    Box(Modifier.fillMaxSize().background(Pale), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier.widthIn(max = 560.dp)
                .fillMaxSize()
                .background(Pale)
                .systemBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(28.dp),
            verticalArrangement = Arrangement.spacedBy(22.dp),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Image(
                    painterResource(R.drawable.connect_logo),
                    "Connect",
                    Modifier.width(145.dp).height(32.dp),
                )
                Spacer(Modifier.weight(1f))
                ConnectButton(onClick = onSignIn) { Text("Sign in") }
            }
            Spacer(Modifier.height(56.dp))
            Image(painterResource(R.drawable.connect_icon), null, Modifier.size(72.dp))
            Text(
                "Connect.\nTalk.\nCelebrate.",
                fontSize = 48.sp,
                lineHeight = 55.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = (-1.5).sp,
                color = Ink,
            )
            Text(
                "A place for the people and companies moving solar forward.",
                color = Muted,
                style = MaterialTheme.typography.bodyLarge,
                lineHeight = 27.sp,
            )
            Spacer(Modifier.height(16.dp))
            AccountButton("Create account", false, onClick = onCreate)
            TextButton(onClick = onBrowse, modifier = Modifier.fillMaxWidth()) {
                Text("Explore the community first")
            }
        }
    }
}

@Composable
private fun AccountShell(back: (() -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    Box(Modifier.fillMaxSize().background(Pale), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier.widthIn(max = 520.dp)
                .fillMaxSize()
                .background(Pale)
                .systemBarsPadding()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 26.dp)
        ) {
            Row(
                Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 30.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (back != null) {
                    IconButton(onClick = back, modifier = Modifier.offset(x = (-12).dp)) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back")
                    }
                    Spacer(Modifier.width(6.dp))
                }
                Image(
                    painterResource(R.drawable.connect_logo),
                    "Connect",
                    Modifier.width(142.dp).height(32.dp),
                    contentScale = ContentScale.Fit,
                )
            }
            content()
            Spacer(Modifier.height(32.dp))
            Row(
                Modifier.fillMaxWidth().padding(bottom = 24.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.VerifiedUser, null, Modifier.size(14.dp), tint = Muted)
                Spacer(Modifier.width(6.dp))
                Text(
                    "Connect. Talk. Celebrate.",
                    style = MaterialTheme.typography.labelSmall,
                    color = Muted,
                )
            }
        }
    }
}

@Composable
private fun AccountHeading(eyebrow: String, title: String, body: String) {
    Text(
        eyebrow,
        style = MaterialTheme.typography.labelSmall,
        letterSpacing = 1.2.sp,
        color = Muted,
    )
    Text(
        title,
        Modifier.padding(top = 12.dp, bottom = 14.dp),
        fontSize = 31.sp,
        lineHeight = 37.sp,
        letterSpacing = (-.7).sp,
        fontWeight = FontWeight.SemiBold,
        color = Ink,
    )
    Text(body, color = Muted, style = MaterialTheme.typography.bodyMedium, lineHeight = 23.sp)
    Spacer(Modifier.height(28.dp))
}

@Composable
internal fun AccountButton(
    text: String,
    busy: Boolean,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    ConnectButton(
        onClick = onClick,
        enabled = enabled && !busy,
        shape = RoundedCornerShape(13.dp),
        modifier = Modifier.fillMaxWidth().height(54.dp),
        contentPadding = PaddingValues(horizontal = 18.dp),
    ) {
        if (busy) {
            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Ink)
            Spacer(Modifier.width(10.dp))
        }
        Text(if (busy) "Just a moment…" else text, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.width(9.dp))
        if (!busy) Icon(Icons.AutoMirrored.Outlined.ArrowForward, null, Modifier.size(18.dp))
    }
}

@Composable
private fun AccountField(
    value: String,
    change: (String) -> Unit,
    label: String,
    keyboard: KeyboardType = KeyboardType.Text,
    secret: Boolean = false,
    hint: String? = null,
) {
    var show by remember { mutableStateOf(false) }
    OutlinedTextField(
        value,
        change,
        label = { Text(label) },
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
        shape = RoundedCornerShape(12.dp),
        colors =
            OutlinedTextFieldDefaults.colors(
                unfocusedBorderColor = Color(0xFFDCE5ED),
                unfocusedContainerColor = Color(0xFFFBFDFF),
            ),
        keyboardOptions = KeyboardOptions(keyboardType = keyboard),
        visualTransformation =
            if (secret && !show) PasswordVisualTransformation() else VisualTransformation.None,
        trailingIcon =
            if (secret) {
                {
                    IconButton(onClick = { show = !show }) {
                        Icon(
                            if (show) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                            if (show) "Hide password" else "Show password",
                            Modifier.size(20.dp),
                        )
                    }
                }
            } else null,
        supportingText =
            if (hint != null) {
                { Text(hint, style = MaterialTheme.typography.labelSmall, color = Muted) }
            } else null,
    )
}

@Composable
private fun AccountError(model: CommunityModel) {
    model.error?.let {
        Surface(
            color = Color(0xFFFFF0EC),
            shape = RoundedCornerShape(10.dp),
            modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
        ) {
            Text(
                it,
                Modifier.padding(14.dp),
                color = Color(0xFFB24130),
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
internal fun AuthScreen(
    model: CommunityModel,
    initialMode: String,
    onClose: () -> Unit,
    onSignedIn: () -> Unit,
) {
    var accountType by rememberSaveable { mutableStateOf("company") }
    var mode by rememberSaveable { mutableStateOf(initialMode) }
    var email by rememberSaveable { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var code by rememberSaveable { mutableStateOf("") }
    var challenge by rememberSaveable { mutableStateOf("") }
    var notice by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(model.signedIn) { if (model.signedIn) onSignedIn() }
    val back = {
        if (mode == "forgot" || mode == "reset") {
            mode = "login"
            password = ""
            model.dismissError()
        } else onClose()
    }
    BackHandler(!model.busy) { back() }
    AccountShell(back = { if (!model.busy) back() }) {
        AccountHeading(
            if (mode == "register") "YOUR NEXT CHAPTER"
            else if (mode == "login") "YOUR INDUSTRY IS HERE" else "LET’S GET YOU BACK IN",
            when (mode) {
                "register" -> "Make your connections."
                "forgot" -> "Forgot your password?"
                "reset" -> "A fresh start."
                else -> "Welcome back."
            },
            when (mode) {
                "register" -> "Meet the companies moving solar forward."
                "forgot" -> "We’ll email you a six-digit code to reset it."
                "reset" -> "If an account exists for $email, a code is on its way."
                else -> "Pick up where your last conversation left off."
            },
        )
        Column(verticalArrangement = Arrangement.spacedBy(15.dp)) {
            if (mode == "register") {
                Text("I’m here as", style = MaterialTheme.typography.labelLarge)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    listOf("company" to "A company", "individual" to "An individual").forEach {
                        (type, label) ->
                        OutlinedCard(
                            onClick = { accountType = type },
                            modifier = Modifier.weight(1f),
                            colors =
                                CardDefaults.outlinedCardColors(
                                    containerColor = if (accountType == type) Color.White else Pale
                                ),
                            border =
                                androidx.compose.foundation.BorderStroke(
                                    1.dp,
                                    if (accountType == type) Muted else Color(0xFFD7E3ED),
                                ),
                        ) {
                            Column(
                                Modifier.padding(15.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Icon(
                                    if (type == "company") Icons.Outlined.Business
                                    else Icons.Outlined.Person,
                                    null,
                                    tint = if (accountType == type) Orange else Muted,
                                )
                                Text(label, style = MaterialTheme.typography.labelLarge)
                                Text(
                                    if (type == "company") "Publish and manage your company"
                                    else "Follow, review, and message companies",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = Muted,
                                )
                            }
                        }
                    }
                }
            }
            if (mode == "register") AccountField(name, { name = it.take(100) }, "Your name")
            if (mode != "reset")
                AccountField(
                    email,
                    { email = it.take(254) },
                    if (accountType == "individual") "Email" else "Work email",
                    KeyboardType.Email,
                )
            if (mode == "reset")
                AccountField(
                    code,
                    { code = it.filter(Char::isDigit).take(6) },
                    "Email code",
                    KeyboardType.Number,
                )
            if (mode != "forgot")
                AccountField(
                    password,
                    { password = it.take(128) },
                    if (mode == "reset") "New password" else "Password",
                    KeyboardType.Password,
                    true,
                    if (mode != "login") "At least 12 characters. A memorable phrase works well."
                    else null,
                )
        }
        if (mode == "login")
            TextButton(
                onClick = {
                    mode = "forgot"
                    password = ""
                    model.dismissError()
                },
                modifier = Modifier.align(Alignment.End),
            ) {
                Text("Forgot password?", style = MaterialTheme.typography.labelMedium)
            }
        if (notice.isNotEmpty())
            Text(
                notice,
                Modifier.padding(vertical = 14.dp),
                color = Color(0xFF267B61),
                style = MaterialTheme.typography.bodySmall,
            )
        AccountError(model)
        Spacer(Modifier.height(22.dp))
        AccountButton(
            when (mode) {
                "register" -> "Create account"
                "forgot" -> "Send reset code"
                "reset" -> "Reset password"
                else -> "Sign in"
            },
            model.busy,
            enabled =
                email.contains('@') &&
                    (mode == "forgot" || password.length >= if (mode == "login") 1 else 12) &&
                    (mode != "register" || name.trim().length >= 2) &&
                    (mode != "reset" || code.length == 6),
        ) {
            when (mode) {
                "forgot" ->
                    model.accountAction(
                        "/auth/password/request",
                        JSONObject().put("email", email),
                    ) {
                        challenge = it.getString("challengeId")
                        mode = "reset"
                    }
                "reset" ->
                    model.accountAction(
                        "/auth/password/reset",
                        JSONObject()
                            .put("challengeId", challenge)
                            .put("code", code)
                            .put("password", password),
                    ) {
                        password = ""
                        mode = "login"
                        notice = "Password updated. Sign in with your new password."
                    }
                else ->
                    model.authenticate(
                        email,
                        password,
                        if (mode == "register") name else null,
                        accountType = accountType,
                    )
            }
        }
        if (mode == "login" || mode == "register")
            TextButton(
                onClick = {
                    mode = if (mode == "login") "register" else "login"
                    password = ""
                    notice = ""
                    model.dismissError()
                },
                modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 20.dp),
            ) {
                Text(
                    if (mode == "login") "New to Connect? Create an account"
                    else "Already have an account? Sign in",
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        Spacer(Modifier.height(60.dp))
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun OnboardingScreen(
    model: CommunityModel,
    onSignOut: () -> Unit,
    onComplete: () -> Unit = {},
) {
    val user = model.session?.optJSONObject("user")
    val verify =
        model.session?.optBoolean("verificationRequired", true) != false &&
            user?.isNull("email_verified_at") != false
    var username by rememberSaveable {
        mutableStateOf(
            model.company?.optString("username").orEmpty().takeUnless { it == "null" }.orEmpty()
        )
    }
    var step by rememberSaveable { mutableStateOf(if (model.individual) "follow" else "company") }
    var name by rememberSaveable { mutableStateOf(model.company?.optString("name").orEmpty()) }
    var location by rememberSaveable {
        mutableStateOf(model.company?.optString("location").orEmpty())
    }
    var type by rememberSaveable { mutableStateOf(model.company?.optString("type") ?: "Installer") }
    var selected by rememberSaveable { mutableStateOf(emptyList<String>()) }
    var follows by rememberSaveable { mutableStateOf(emptyList<String>()) }
    var code by rememberSaveable { mutableStateOf("") }
    var cooldown by rememberSaveable { mutableIntStateOf(0) }
    LaunchedEffect(cooldown) {
        if (cooldown > 0) {
            delay(1000)
            cooldown--
        }
    }
    LaunchedEffect(step) { if (step == "follow") model.load("/companies") }
    fun complete(ids: List<String> = emptyList()) {
        model.accountAction("/onboarding/complete", JSONObject().put("followIds", JSONArray(ids))) {
            onComplete()
        }
    }
    AccountShell {
        Row(
            Modifier.fillMaxWidth().padding(bottom = 30.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            (if (model.individual) listOf("Email", "Community")
                else listOf("Email", "Company", "Community"))
                .forEachIndexed { index, label ->
                    Text(
                        "${index + 1}  $label",
                        color =
                            if (
                                index ==
                                    if (verify) 0
                                    else if (model.individual || step == "company") 1 else 2
                            )
                                Orange
                            else Muted,
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
        }
        if (verify) {
            Icon(
                Icons.Outlined.MarkEmailUnread,
                null,
                Modifier.size(56.dp).background(Pale, RoundedCornerShape(16.dp)).padding(15.dp),
                tint = Navy,
            )
            Spacer(Modifier.height(24.dp))
            AccountHeading(
                "ONE QUICK CHECK",
                "Check your inbox.",
                "Enter the six-digit code sent to ${user?.optString("email")}. Codes expire after 10 minutes.",
            )
            AccountField(
                code,
                { code = it.filter(Char::isDigit).take(6) },
                "Verification code",
                KeyboardType.Number,
            )
            AccountError(model)
            Spacer(Modifier.height(24.dp))
            AccountButton(
                "Verify email",
                model.busy,
                code.length == 6 && model.verificationChallenge.isNotBlank(),
            ) {
                model.accountAction(
                    "/auth/verification/confirm",
                    JSONObject().put("challengeId", model.verificationChallenge).put("code", code),
                )
            }
            TextButton(
                enabled = !model.busy && cooldown == 0,
                onClick = { model.accountAction("/auth/verification/request") { cooldown = 60 } },
                modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 18.dp),
            ) {
                Text(
                    if (cooldown > 0) "Resend in ${cooldown}s"
                    else if (model.verificationChallenge.isBlank()) "Send verification code"
                    else "Resend code"
                )
            }
            Text(
                "Check your spam folder too.",
                Modifier.align(Alignment.CenterHorizontally),
                color = Muted,
                style = MaterialTheme.typography.bodySmall,
            )
        } else if (step == "company") {
            AccountHeading(
                "A NAME BEHIND EVERY CONVERSATION",
                "Introduce your company.",
                "Help the right people find you. You can refine your profile anytime.",
            )
            AccountField(name, { name = it.take(120) }, "Company name")
            Spacer(Modifier.height(16.dp))
            AccountField(
                username,
                { username = it.lowercase().replace(" ", "").take(30) },
                "Company username",
                hint = "3–30 letters, numbers, or hyphens",
            )
            Spacer(Modifier.height(22.dp))
            Text("What best describes your business?", style = MaterialTheme.typography.labelLarge)
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.padding(vertical = 8.dp),
            ) {
                listOf(
                        "Installer",
                        "EPC",
                        "Developer",
                        "Distributor",
                        "Manufacturer",
                        "Service provider",
                    )
                    .forEach { value ->
                        FilterChip(
                            selected = type == value,
                            onClick = { type = value },
                            label = { Text(value, style = MaterialTheme.typography.labelMedium) },
                            leadingIcon =
                                if (type == value) {
                                    { Icon(Icons.Outlined.Check, null, Modifier.size(15.dp)) }
                                } else null,
                        )
                    }
            }
            AccountField(
                location,
                { location = it.take(160) },
                "Based in",
                hint = "City, state or country",
            )
            Text(
                "Your services · optional",
                Modifier.padding(top = 18.dp),
                style = MaterialTheme.typography.labelLarge,
            )
            FlowRow(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                listOf(
                        "Installation",
                        "Design",
                        "Engineering",
                        "O&M",
                        "Energy storage",
                        "Equipment supply",
                    )
                    .forEach { value ->
                        FilterChip(
                            selected = value in selected,
                            onClick = {
                                selected =
                                    if (value in selected) selected - value else selected + value
                            },
                            label = { Text(value, style = MaterialTheme.typography.labelSmall) },
                        )
                    }
            }
            AccountError(model)
            Spacer(Modifier.height(20.dp))
            AccountButton(
                "Continue",
                model.busy,
                name.trim().length >= 2 && location.trim().length >= 2,
            ) {
                model.accountAction(
                    "/onboarding/company",
                    JSONObject()
                        .put("name", name)
                        .apply { if (username.isNotBlank()) put("username", username) }
                        .put("type", type)
                        .put("location", location)
                        .put("services", JSONArray(selected)),
                ) {
                    step = "follow"
                }
            }
            TextButton(
                enabled = !model.busy,
                onClick = { complete() },
                modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 12.dp),
            ) {
                Text(
                    "Invited by your company? Use your invitation link",
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        } else {
            AccountHeading(
                "MAKE YOURSELF AT HOME",
                "Find your people.",
                "Follow companies to see their updates. Connections start with a conversation.",
            )
            model.pages["/companies"]
                ?.optJSONArray("companies")
                .objects()
                .filter { it.optString("id") != model.company?.optString("id") }
                .take(6)
                .forEach { c ->
                    val id = c.optString("id")
                    Row(
                        Modifier.fillMaxWidth().padding(vertical = 13.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        CompanyAvatar(c)
                        Column(Modifier.weight(1f)) {
                            Text(c.optString("name"), style = MaterialTheme.typography.labelLarge)
                            Text(
                                c.optString("type"),
                                style = MaterialTheme.typography.labelSmall,
                                color = Muted,
                            )
                        }
                        ConnectOutlinedButton(
                            onClick = {
                                follows = if (id in follows) follows - id else follows + id
                            },
                            contentPadding = PaddingValues(horizontal = 12.dp),
                        ) {
                            Text(
                                if (id in follows) "Following" else "+ Follow",
                                style = MaterialTheme.typography.labelSmall,
                            )
                        }
                    }
                    HorizontalDivider(color = Pale)
                }
            AccountError(model)
            Spacer(Modifier.height(24.dp))
            AccountButton("Let’s go", model.busy) { complete(follows) }
            TextButton(
                onClick = { complete() },
                enabled = !model.busy,
                modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 14.dp),
            ) {
                Text("I’ll explore first")
            }
        }
        TextButton(
            onClick = onSignOut,
            enabled = !model.busy,
            modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 24.dp),
        ) {
            Text("Sign out", color = Muted, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
internal fun SecurityScreen(model: CommunityModel, onClose: () -> Unit) {
    var current by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var notice by remember { mutableStateOf("") }
    LaunchedEffect(Unit) { model.load("/auth/sessions", true) }
    BackHandler { onClose() }
    AccountShell(back = onClose) {
        AccountHeading(
            "YOUR ACCOUNT",
            "You’re in control.",
            "Manage your password and where you’re signed in.",
        )
        Text(
            model.session?.optJSONObject("user")?.optString("name").orEmpty(),
            style = MaterialTheme.typography.titleMedium,
        )
        Text(
            model.session?.optJSONObject("user")?.optString("email").orEmpty(),
            color = Muted,
            style = MaterialTheme.typography.bodyMedium,
        )
        Text(
            "Change password",
            Modifier.padding(top = 30.dp, bottom = 12.dp),
            style = MaterialTheme.typography.titleMedium,
        )
        AccountField(
            current,
            { current = it.take(128) },
            "Current password",
            KeyboardType.Password,
            true,
        )
        Spacer(Modifier.height(12.dp))
        AccountField(
            password,
            { password = it.take(128) },
            "New password",
            KeyboardType.Password,
            true,
            "Use at least 12 characters.",
        )
        AccountError(model)
        if (notice.isNotEmpty())
            Text(
                notice,
                Modifier.padding(vertical = 12.dp),
                color = Color(0xFF267B61),
                style = MaterialTheme.typography.bodySmall,
            )
        Spacer(Modifier.height(18.dp))
        AccountButton(
            "Update password",
            model.busy,
            current.isNotBlank() && password.length >= 12,
        ) {
            model.accountAction(
                "/auth/password/change",
                JSONObject().put("currentPassword", current).put("password", password),
            ) {
                current = ""
                password = ""
                notice = "Password updated. Other devices signed out."
                model.load("/auth/sessions", true)
            }
        }
        Text(
            "Your devices",
            Modifier.padding(top = 34.dp, bottom = 10.dp),
            style = MaterialTheme.typography.titleMedium,
        )
        val devices = model.pages["/auth/sessions"]?.optJSONArray("sessions").objects()
        devices.forEach { device ->
            Row(
                Modifier.fillMaxWidth().padding(vertical = 15.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                val android = device.optString("user_agent").contains("Android", true)
                Icon(
                    if (android) Icons.Outlined.Smartphone else Icons.Outlined.Computer,
                    null,
                    tint = Muted,
                )
                Column(Modifier.weight(1f)) {
                    Text(
                        if (android) "Connect for Android" else "Web browser",
                        style = MaterialTheme.typography.labelLarge,
                    )
                    Text(
                        if (device.optBoolean("current")) "This device"
                        else "Active ${device.optString("last_seen_at").take(10)}",
                        style = MaterialTheme.typography.labelSmall,
                        color = Muted,
                    )
                }
                if (device.optBoolean("current"))
                    Icon(
                        Icons.Outlined.CheckCircle,
                        "Current device",
                        tint = Color(0xFF419A80),
                        modifier = Modifier.size(19.dp),
                    )
                else
                    TextButton(
                        enabled = !model.busy,
                        onClick = {
                            model.accountAction(
                                "/auth/sessions/revoke",
                                JSONObject().put("id", device.optString("id")),
                            ) {
                                model.load("/auth/sessions", true)
                            }
                        },
                    ) {
                        Text("Sign out")
                    }
            }
        }
        if (devices.size > 1)
            ConnectOutlinedButton(
                enabled = !model.busy,
                onClick = {
                    model.accountAction("/auth/sessions/revoke", JSONObject().put("others", true)) {
                        model.load("/auth/sessions", true)
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Sign out other devices")
            }
    }
}
