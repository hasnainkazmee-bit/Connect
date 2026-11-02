package com.sunhub.community

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil3.compose.AsyncImage
import org.json.JSONArray
import org.json.JSONObject

internal fun JSONObject.text(key: String) = optString(key).takeUnless { it == "null" }.orEmpty()

internal fun mediaUrl(model: CommunityModel, path: String) =
    if (path.startsWith("/")) model.baseUrl + path else path

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun WorkSheet(
    model: CommunityModel,
    title: String,
    close: () -> Unit,
    action: String? = null,
    enabled: Boolean = true,
    save: () -> Unit = {},
    secondaryAction: String? = null,
    secondary: () -> Unit = {},
    content: @Composable ColumnScope.() -> Unit,
) {
    Dialog(
        onDismissRequest = { if (!model.busy) close() },
        properties =
            DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        BackHandler { if (!model.busy) close() }
        Box(
            Modifier.fillMaxSize().systemBarsPadding().imePadding(),
            contentAlignment = Alignment.TopCenter,
        ) {
            Scaffold(
                modifier =
                    Modifier.widthIn(max = WorkspaceWidthDp.dp)
                        .fillMaxSize()
                        .clip(ConnectCardShape),
                containerColor = Color.White,
                topBar = {
                    TopAppBar(
                        title = {
                            Text(
                                title,
                                style = MaterialTheme.typography.titleMedium,
                                maxLines = 1,
                                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                            )
                        },
                        navigationIcon = {
                            IconButton(enabled = !model.busy, onClick = close) {
                                Icon(Icons.Outlined.Close, "Close")
                            }
                        },
                        actions = {
                            if (secondaryAction != null)
                                TextButton(enabled = !model.busy, onClick = secondary) {
                                    Text(secondaryAction)
                                }
                        },
                        colors = TopAppBarDefaults.topAppBarColors(containerColor = Pale),
                    )
                },
                bottomBar = {
                    if (action != null)
                        Surface(shadowElevation = 5.dp) {
                            Column(Modifier.padding(16.dp)) {
                                ConnectButton(
                                    onClick = save,
                                    enabled = enabled && !model.busy,
                                    modifier = Modifier.fillMaxWidth().height(50.dp),
                                    shape = ConnectPillShape,
                                ) {
                                    if (model.busy) {
                                        CircularProgressIndicator(
                                            Modifier.size(18.dp),
                                            strokeWidth = 2.dp,
                                        )
                                        Spacer(Modifier.width(10.dp))
                                    }
                                    Text(if (model.busy) "Saving…" else action)
                                }
                            }
                        }
                },
            ) { padding ->
                Column(
                    Modifier.fillMaxSize()
                        .padding(padding)
                        .verticalScroll(rememberScrollState())
                        .padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    model.error?.let {
                        Text(
                            it,
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                    content()
                }
            }
        }
    }
}

@Composable
internal fun WorkField(
    label: String,
    value: String,
    change: (String) -> Unit,
    lines: Int = 1,
    limit: Int = 3000,
    hint: String? = null,
) {
    OutlinedTextField(
        value,
        { change(it.take(limit)) },
        label = { Text(label) },
        singleLine = lines == 1,
        minLines = lines,
        modifier = Modifier.fillMaxWidth(),
        shape = if (lines == 1) ConnectPillShape else ConnectCardShape,
        supportingText =
            if (hint != null) {
                { Text(hint) }
            } else null,
        colors =
            OutlinedTextFieldDefaults.colors(
                unfocusedBorderColor = Color(0xFFD9E3EC),
                focusedContainerColor = Color.White,
                unfocusedContainerColor = Color(0xFFFBFCFE),
            ),
    )
}

@Composable
internal fun ConfirmLeave(dirty: Boolean, onDiscard: () -> Unit, onKeep: () -> Unit) {
    if (dirty)
        AlertDialog(
            onDismissRequest = onKeep,
            title = { Text("Keep your changes?") },
            text = { Text("They haven’t been saved yet.") },
            confirmButton = { TextButton(onClick = onKeep) { Text("Keep editing") } },
            dismissButton = { TextButton(onClick = onDiscard) { Text("Discard changes") } },
        )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun EditCompany(model: CommunityModel, c: JSONObject, close: () -> Unit) {
    var name by rememberSaveable { mutableStateOf(c.text("name")) }
    var username by rememberSaveable { mutableStateOf(c.text("username")) }
    var headline by rememberSaveable { mutableStateOf(c.text("tagline")) }
    var about by rememberSaveable { mutableStateOf(c.text("description")) }
    var location by rememberSaveable { mutableStateOf(c.text("location")) }
    var website by rememberSaveable { mutableStateOf(c.text("website")) }
    var type by rememberSaveable { mutableStateOf(c.text("type")) }
    var size by rememberSaveable { mutableStateOf(c.text("employee_count")) }
    var founded by rememberSaveable { mutableStateOf(c.text("established")) }
    var services by rememberSaveable {
        mutableStateOf(c.optJSONArray("services").strings().joinToString(", "))
    }
    var areas by rememberSaveable {
        mutableStateOf(c.optJSONArray("service_areas").strings().joinToString(", "))
    }
    var dirty by rememberSaveable { mutableStateOf(false) }
    var leaving by remember { mutableStateOf(false) }
    val leave = { if (dirty) leaving = true else close() }
    WorkSheet(
        model,
        "Edit company profile",
        leave,
        "Save changes",
        name.trim().length >= 2,
        save = {
            model.perform({
                val b =
                    JSONObject()
                        .put("name", name)
                        .put("tagline", headline)
                        .put("description", about)
                        .put("location", location)
                        .put("type", type)
                        .put("website", website)
                        .put("employee_count", size)
                        .put("established", founded.toIntOrNull() ?: JSONObject.NULL)
                        .put(
                            "services",
                            JSONArray(
                                services.split(',').map { it.trim() }.filter { it.isNotEmpty() }
                            ),
                        )
                        .put(
                            "service_areas",
                            JSONArray(areas.split(',').map { it.trim() }.filter { it.isNotEmpty() }),
                        )
                if (username.isNotBlank()) b.put("username", username)
                model.jsonRequest("PATCH", "/companies/current/profile", b)
            }) {
                model.refreshCompany()
                close()
            }
        },
    ) {
        Text("Make your company easy to know.", style = MaterialTheme.typography.headlineSmall)
        Text("Your story, your expertise, and where people can find you.", color = Muted)
        WorkField(
            "Company name",
            name,
            {
                name = it
                dirty = true
            },
            limit = 120,
        )
        WorkField(
            "Company username",
            username,
            {
                username = it.lowercase()
                dirty = true
            },
            limit = 30,
            hint = "Letters, numbers, and hyphens. Your public profile address.",
        )
        WorkField(
            "Headline",
            headline,
            {
                headline = it
                dirty = true
            },
            limit = 200,
        )
        Text("Business type", style = MaterialTheme.typography.labelLarge)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            listOf(
                    "Installer",
                    "EPC",
                    "Developer",
                    "Distributor",
                    "Manufacturer",
                    "Service provider",
                )
                .forEach { v ->
                    ConnectFilterChip(
                        type == v,
                        {
                            type = v
                            dirty = true
                        },
                        label = { Text(v) },
                    )
                }
        }
        WorkField(
            "Based in",
            location,
            {
                location = it
                dirty = true
            },
            limit = 160,
        )
        WorkField(
            "About",
            about,
            {
                about = it
                dirty = true
            },
            lines = 5,
        )
        WorkField(
            "Website",
            website,
            {
                website = it
                dirty = true
            },
            limit = 2000,
            hint = "Include https://",
        )
        Text("Company size", style = MaterialTheme.typography.labelLarge)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            listOf("1–10", "11–50", "51–200", "201–500", "501–1,000", "1,000+").forEach { v ->
                ConnectFilterChip(
                    size == v,
                    {
                        size = if (size == v) "" else v
                        dirty = true
                    },
                    label = { Text(v) },
                )
            }
        }
        WorkField(
            "Founded",
            founded,
            {
                founded = it.filter(Char::isDigit)
                dirty = true
            },
            limit = 4,
        )
        WorkField(
            "Services",
            services,
            {
                services = it
                dirty = true
            },
            lines = 2,
            hint = "Separate services with commas.",
        )
        WorkField(
            "Areas served",
            areas,
            {
                areas = it
                dirty = true
            },
            lines = 2,
            hint = "Separate states or regions with commas.",
        )
    }
    if (leaving) ConfirmLeave(true, close) { leaving = false }
}

@Composable
internal fun CompanyPhoto(model: CommunityModel, c: JSONObject, slot: String, close: () -> Unit) {
    var selected by remember { mutableStateOf<com.sunhub.core.UploadFile?>(null) }
    val picker =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri != null)
                model.pickMedia(listOf(uri), true) { files ->
                    selected?.let { MediaFiles.discard(listOf(it)) }
                    selected = files.firstOrNull()
                }
        }
    WorkSheet(
        model,
        if (slot == "logo") "Company logo" else "Cover photo",
        {
            selected?.let { MediaFiles.discard(listOf(it)) }
            close()
        },
        "Save photo",
        selected != null,
        save = {
            model.perform({
                val asset = model.uploadOne("/companies/current/assets", selected!!)
                model.jsonRequest(
                    "PUT",
                    "/companies/current/branding",
                    JSONObject().put("slot", slot).put("assetId", asset.getString("id")),
                )
            }) {
                selected?.let { MediaFiles.discard(listOf(it)) }
                model.refreshCompany()
                close()
            }
        },
    ) {
        Text("A familiar face for your company.", style = MaterialTheme.typography.headlineSmall)
        val source = selected?.path ?: c.text(if (slot == "logo") "logo_url" else "cover_url")
        if (source.isNotBlank())
            AsyncImage(
                if (selected != null) java.io.File(source) else mediaUrl(model, source),
                "Photo preview",
                Modifier.fillMaxWidth().height(if (slot == "logo") 240.dp else 190.dp),
                contentScale = if (slot == "logo") ContentScale.Fit else ContentScale.Crop,
            )
        ConnectOutlinedButton(
            onClick = { picker.launch(arrayOf("image/jpeg", "image/png", "image/webp")) },
            enabled = !model.busy,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Icon(Icons.Outlined.AddPhotoAlternate, null)
            Spacer(Modifier.width(8.dp))
            Text("Choose a photo")
        }
        Text(
            "JPG, PNG, or WebP. Up to 10 MB.",
            color = Muted,
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

@Composable
internal fun EmployeeAccess(model: CommunityModel, close: () -> Unit) {
    var invite by rememberSaveable { mutableStateOf(false) }
    var email by rememberSaveable { mutableStateOf("") }
    var role by rememberSaveable { mutableStateOf("member") }
    var url by rememberSaveable { mutableStateOf("") }
    var copied by remember { mutableStateOf(false) }
    var remove by remember { mutableStateOf<JSONObject?>(null) }
    val clipboard = LocalClipboardManager.current
    fun reload() {
        model.load("/team", true)
        model.load("/team/invites", true)
    }
    LaunchedEffect(Unit) { reload() }
    WorkSheet(
        model,
        if (invite) "Invite an employee" else "Employee access",
        {
            if (invite) {
                invite = false
                url = ""
                model.dismissError()
            } else close()
        },
        if (invite && url.isEmpty()) "Create invitation" else null,
        email.contains('@'),
        save = {
            model.mutate(
                "/team/invites",
                JSONObject().put("email", email.trim()).put("role", role),
            ) {
                url = it.getString("url")
                reload()
            }
        },
    ) {
        if (invite) {
            Text(
                if (url.isBlank()) "Separate logins. One company." else "Your invitation is ready.",
                style = MaterialTheme.typography.headlineSmall,
            )
            if (url.isBlank()) {
                Text(
                    "Each employee signs in with their own work email. You can remove access anytime.",
                    color = Muted,
                )
                WorkField("Employee’s work email", email, { email = it }, limit = 254)
                listOf("member" to "Messages only", "admin" to "Administrator").forEach {
                    (value, title) ->
                    OutlinedCard(
                        onClick = { role = value },
                        modifier = Modifier.fillMaxWidth(),
                        colors =
                            CardDefaults.outlinedCardColors(
                                containerColor = if (role == value) Pale else Color.White
                            ),
                    ) {
                        Row(
                            Modifier.padding(14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(role == value, { role = value })
                            Column(Modifier.weight(1f)) {
                                Text(title, style = MaterialTheme.typography.titleSmall)
                                Text(
                                    if (value == "admin")
                                        "Publish, edit the profile, manage employees and connections, and reply to messages."
                                    else "Read and reply in the company’s shared inbox.",
                                    color = Muted,
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                        }
                    }
                }
            } else {
                Text(
                    "Share this welcome link with $email. Their invitation expires in 3 days. Only an invited, verified email can get access.",
                    color = Muted,
                )
                OutlinedTextField(
                    url,
                    {},
                    readOnly = true,
                    label = { Text("Invitation link") },
                    modifier = Modifier.fillMaxWidth(),
                )
                ConnectButton(
                    onClick = {
                        clipboard.setText(AnnotatedString(url))
                        copied = true
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(if (copied) "Copied" else "Copy invitation link")
                }
                Text(
                    "No email has been sent. Share the link with your employee.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Muted,
                )
            }
        } else {
            Text("Your people. One shared profile.", style = MaterialTheme.typography.headlineSmall)
            ConnectButton(
                onClick = {
                    invite = true
                    email = ""
                    role = "member"
                    url = ""
                    copied = false
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Icons.Outlined.PersonAdd, null)
                Spacer(Modifier.width(8.dp))
                Text("Invite employee")
            }
            model.pages["/team"]?.optJSONArray("items").objects().forEach { m ->
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(m.text("name"), style = MaterialTheme.typography.titleSmall)
                            Text(
                                m.text("email"),
                                style = MaterialTheme.typography.bodySmall,
                                color = Muted,
                            )
                        }
                        if (
                            m.text("role") != "owner" &&
                                m.text("id") != model.session?.optJSONObject("user")?.text("id") &&
                                (model.company?.text("role") == "owner" ||
                                    m.text("role") == "member")
                        )
                            IconButton(onClick = { remove = m }) {
                                Icon(Icons.Outlined.PersonRemove, "Remove ${m.text("name")}")
                            }
                    }
                    if (model.company?.text("role") == "owner" && m.text("role") != "owner")
                        TextButton(
                            enabled = !model.busy,
                            onClick = {
                                model.perform({
                                    model.jsonRequest(
                                        "PATCH",
                                        "/team/${m.text("id")}/role",
                                        JSONObject()
                                            .put(
                                                "role",
                                                if (m.text("role") == "admin") "member" else "admin",
                                            ),
                                    )
                                }) {
                                    reload()
                                }
                            },
                        ) {
                            Text(
                                if (m.text("role") == "admin")
                                    "Administrator · change to messages only"
                                else "Messages only · make administrator"
                            )
                        }
                    else
                        Text(
                            m.text("role"),
                            style = MaterialTheme.typography.labelSmall,
                            color = Muted,
                        )
                    HorizontalDivider(Modifier.padding(top = 10.dp))
                }
            }
            val invitations = model.pages["/team/invites"]?.optJSONArray("items").objects()
            if (invitations.isNotEmpty())
                Text("Pending invitations", style = MaterialTheme.typography.titleMedium)
            invitations.forEach { i ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(i.text("email"), style = MaterialTheme.typography.bodyMedium)
                        Text(
                            if (i.text("role") == "admin") "Administrator" else "Messages only",
                            color = Muted,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    TextButton(
                        enabled = !model.busy,
                        onClick = {
                            model.perform({
                                model.jsonRequest("DELETE", "/team/invites/${i.text("id")}")
                            }) {
                                reload()
                            }
                        },
                    ) {
                        Text("Revoke")
                    }
                }
            }
        }
    }
    remove?.let { m ->
        AlertDialog(
            onDismissRequest = { remove = null },
            title = { Text("Remove ${m.text("name")}?") },
            text = {
                Text(
                    "They will lose access to your company. Their previous posts and messages stay."
                )
            },
            confirmButton = {
                TextButton(
                    enabled = !model.busy,
                    onClick = {
                        model.perform({ model.jsonRequest("DELETE", "/team/${m.text("id")}") }) {
                            remove = null
                            reload()
                        }
                    },
                ) {
                    Text("Remove access")
                }
            },
            dismissButton = { TextButton(onClick = { remove = null }) { Text("Keep employee") } },
        )
    }
}

@Composable
internal fun PortfolioForm(
    model: CommunityModel,
    entry: JSONObject?,
    achievement: Boolean,
    close: () -> Unit,
) {
    var title by rememberSaveable {
        mutableStateOf(entry?.text(if (achievement) "title" else "name").orEmpty())
    }
    var description by rememberSaveable { mutableStateOf(entry?.text("description").orEmpty()) }
    var location by rememberSaveable {
        mutableStateOf(entry?.text(if (achievement) "issuer" else "location").orEmpty())
    }
    var size by rememberSaveable { mutableStateOf(entry?.text("size").orEmpty()) }
    var year by rememberSaveable {
        mutableStateOf(entry?.text(if (achievement) "year" else "completed_year").orEmpty())
    }
    var link by rememberSaveable { mutableStateOf(entry?.text("url").orEmpty()) }
    var file by remember { mutableStateOf<com.sunhub.core.UploadFile?>(null) }
    var dirty by rememberSaveable { mutableStateOf(false) }
    var leaving by remember { mutableStateOf(false) }
    val picker =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri != null)
                model.pickMedia(listOf(uri), true) { files ->
                    file?.let { MediaFiles.discard(listOf(it)) }
                    file = files.firstOrNull()
                    dirty = true
                }
        }
    val leave = { if (dirty) leaving = true else close() }
    WorkSheet(
        model,
        (if (entry == null) "Add " else "Edit ") + (if (achievement) "achievement" else "project"),
        leave,
        "Save to profile",
        title.trim().length >= 2,
        save = {
            model.perform({
                val body =
                    JSONObject()
                        .put(if (achievement) "title" else "name", title)
                        .put("description", description)
                        .put(if (achievement) "issuer" else "location", location)
                        .put(
                            if (achievement) "year" else "completedYear",
                            year.toIntOrNull() ?: JSONObject.NULL,
                        )
                        .put("url", link)
                if (!achievement) {
                    val image =
                        file?.let {
                            model.uploadOne("/companies/current/assets", it).getString("url")
                        } ?: entry?.text("image_url").orEmpty()
                    body.put("imageUrl", image).put("size", size)
                }
                model.jsonRequest(
                    if (entry == null) "POST" else "PATCH",
                    "/companies/current/" +
                        (if (achievement) "achievements" else "portfolio") +
                        (entry?.let { "/${it.text("id")}" } ?: ""),
                    body,
                )
            }) {
                file?.let { MediaFiles.discard(listOf(it)) }
                model.refreshCompany()
                close()
            }
        },
    ) {
        Text(
            if (achievement) "Something to celebrate." else "Show the work behind your name.",
            style = MaterialTheme.typography.headlineSmall,
        )
        if (!achievement) {
            val image =
                file?.let { java.io.File(it.path) }
                    ?: entry
                        ?.text("image_url")
                        ?.takeIf { it.isNotBlank() }
                        ?.let { mediaUrl(model, it) }
            if (image != null)
                AsyncImage(
                    image,
                    "Project preview",
                    Modifier.fillMaxWidth().height(170.dp),
                    contentScale = ContentScale.Crop,
                )
            ConnectOutlinedButton(
                onClick = { picker.launch(arrayOf("image/jpeg", "image/png", "image/webp")) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Choose project photo")
            }
        }
        WorkField(
            if (achievement) "Title" else "Project name",
            title,
            {
                title = it
                dirty = true
            },
            limit = 150,
        )
        WorkField(
            if (achievement) "Description" else "The story",
            description,
            {
                description = it
                dirty = true
            },
            lines = 4,
            limit = if (achievement) 2000 else 3000,
        )
        WorkField(
            if (achievement) "Issued by" else "Location",
            location,
            {
                location = it
                dirty = true
            },
            limit = 150,
        )
        if (!achievement)
            WorkField(
                "Project size",
                size,
                {
                    size = it
                    dirty = true
                },
                limit = 100,
                hint = "For example, 2.4 MW",
            )
        WorkField(
            if (achievement) "Year" else "Completion year",
            year,
            {
                year = it.filter(Char::isDigit)
                dirty = true
            },
            limit = 4,
        )
        WorkField(
            "Supporting link",
            link,
            {
                link = it
                dirty = true
            },
            limit = 2000,
            hint = "Optional. Include https://",
        )
    }
    if (leaving)
        ConfirmLeave(
            true,
            {
                file?.let { MediaFiles.discard(listOf(it)) }
                close()
            },
        ) {
            leaving = false
        }
}
