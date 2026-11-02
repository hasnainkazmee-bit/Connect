package com.sunhub.community

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import org.json.JSONObject

@Composable
internal fun CompanyProfileScreen(
    model: CommunityModel,
    id: String,
    onSignIn: () -> Unit,
    onMessageSignIn: (JSONObject) -> Unit,
) {
    val data = model.pages["/companies/$id"]
    if (data == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        return
    }
    val c = data.getJSONObject("company")
    val unclaimed = c.text("listing_status") == "unclaimed"
    val own = model.company?.text("id") == c.text("id")
    val edit = own && model.admin
    val stats = model.pages["/social/companies/$id"]
    val context = LocalContext.current
    val uri = LocalUriHandler.current
    var tab by rememberSaveable(id) { mutableStateOf(if (unclaimed) "About" else "Updates") }
    var sheet by rememberSaveable(id) { mutableStateOf("") }
    var entry by remember { mutableStateOf<JSONObject?>(null) }
    var remove by remember { mutableStateOf<Pair<String, String>?>(null) }
    val feed = "/feed?companyId=${c.text("id")}"
    val reviews = "/companies/${c.text("id")}/reviews"
    var pages by rememberSaveable(id) { mutableStateOf(listOf(feed)) }
    var reviewPage by rememberSaveable(id) { mutableIntStateOf(1) }
    LaunchedEffect(tab, pages.last(), reviewPage) {
        when (tab) {
            "Updates" -> model.load(pages.last())
            "Reviews" -> model.load("$reviews?page=$reviewPage")
        }
    }
    fun add(which: String, item: JSONObject? = null) {
        entry = item
        sheet = which
    }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Box(Modifier.fillMaxWidth().height(155.dp).background(Pale)) {
                if (c.text("cover_url").isNotBlank())
                    AsyncImage(
                        mediaUrl(model, c.text("cover_url")),
                        "Company cover",
                        Modifier.fillMaxSize(),
                        contentScale = ContentScale.Crop,
                    )
                if (edit)
                    FilledTonalIconButton(
                        onClick = { sheet = "cover" },
                        modifier = Modifier.align(Alignment.BottomEnd).padding(8.dp),
                    ) {
                        Icon(Icons.Outlined.CameraAlt, "Edit cover photo")
                    }
            }
        }
        item {
            Column(
                Modifier.padding(horizontal = 20.dp),
                verticalArrangement = Arrangement.spacedBy(11.dp),
            ) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Box {
                        CompanyAvatar(c, 64)
                        if (edit)
                            IconButton(
                                onClick = { sheet = "logo" },
                                modifier =
                                    Modifier.align(Alignment.BottomEnd)
                                        .size(24.dp)
                                        .background(Color.White, RoundedCornerShape(8.dp)),
                            ) {
                                Icon(Icons.Outlined.Edit, "Edit company logo", Modifier.size(15.dp))
                            }
                    }
                    Spacer(Modifier.weight(1f))
                    IconButton(
                        onClick = {
                            val link =
                                model.baseUrl +
                                    "/" +
                                    c.text("username").ifBlank { "company/" + c.text("slug") }
                            context.startActivity(
                                Intent.createChooser(
                                    Intent(Intent.ACTION_SEND)
                                        .setType("text/plain")
                                        .putExtra(Intent.EXTRA_TEXT, link),
                                    "Share company profile",
                                )
                            )
                        }
                    ) {
                        Icon(Icons.Outlined.Share, "Share profile")
                    }
                }
                Text(c.text("name"), style = MaterialTheme.typography.headlineSmall)
                if (c.text("username").isNotBlank())
                    Text(
                        "@${c.text("username")}",
                        style = MaterialTheme.typography.labelMedium,
                        color = Muted,
                    )
                if (c.text("tagline").isNotBlank()) Text(c.text("tagline"), color = Muted)
                Text(
                    listOf(c.text("type"), c.text("location"))
                        .filter { it.isNotBlank() }
                        .joinToString(" · "),
                    style = MaterialTheme.typography.bodyMedium,
                    color = Muted,
                )
                val rating = data.optJSONObject("rating")
                if ((rating?.optInt("count") ?: 0) > 0)
                    Text(
                        "★ ${rating?.optDouble("average")} · ${rating?.optInt("count")} customer reviews",
                        style = MaterialTheme.typography.labelMedium,
                    )
                if (edit)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        ConnectButton(onClick = { sheet = "profile" }) { Text("Edit profile") }
                        ConnectOutlinedButton(onClick = { sheet = "employees" }) {
                            Text("Invite employees")
                        }
                    }
                else if (!own)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        ConnectButton(
                            onClick = {
                                if (unclaimed) uri.openUri(c.text("website"))
                                else if (model.signedIn) model.chat(c) else onMessageSignIn(c)
                            }
                        ) {
                            Text(if (unclaimed) "Visit website" else "Message")
                        }
                        ConnectOutlinedButton(
                            enabled =
                                !model.busy && (!model.signedIn || model.admin || model.individual),
                            onClick = {
                                if (!model.signedIn) onSignIn()
                                else
                                    model.mutate(
                                        "/social/companies/${c.text("id")}/follow",
                                        JSONObject()
                                            .put(
                                                "following",
                                                !(stats?.optBoolean("following") ?: false),
                                            ),
                                    ) {
                                        model.load("/social/companies/$id", true)
                                    }
                            },
                        ) {
                            Text(
                                if (stats?.optBoolean("following") == true) "Following"
                                else "Follow"
                            )
                        }
                    }
                if (unclaimed)
                    OutlinedCard(
                        onClick = { uri.openUri(model.baseUrl + "/claim/" + c.text("username")) }
                    ) {
                        Column(
                            Modifier.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Text(
                                "Is this your company?",
                                style = MaterialTheme.typography.titleSmall,
                            )
                            Text(
                                "Claim this profile to publish updates and talk on Connect.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = Muted,
                            )
                        }
                    }
            }
        }
        item {
            LazyRow(
                contentPadding = PaddingValues(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                items(
                    if (unclaimed) listOf("About", "Reviews")
                    else listOf("Updates", "About", "Portfolio", "People", "Reviews")
                ) { value ->
                    FilterChip(tab == value, { tab = value }, label = { Text(value) })
                }
            }
        }
        when (tab) {
            "Updates" -> {
                if (edit)
                    item {
                        Row(
                            Modifier.padding(horizontal = 16.dp),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            ConnectButton(
                                onClick = { sheet = "publish" },
                                modifier = Modifier.weight(1f),
                            ) {
                                Icon(Icons.Outlined.Edit, null, Modifier.size(18.dp))
                                Spacer(Modifier.width(8.dp))
                                Text("Share an update")
                            }
                            ConnectOutlinedButton(onClick = { sheet = "drafts" }) { Text("Drafts") }
                        }
                    }
                val posts =
                    pages
                        .flatMap { model.pages[it]?.optJSONArray("posts").objects() }
                        .distinctBy { it.text("id") }
                items(posts, key = { it.text("id") }) { post -> PublicationCard(model, post) }
                if (posts.isEmpty())
                    item {
                        Text(
                            "This company’s stories will appear here.",
                            Modifier.padding(20.dp),
                            color = Muted,
                        )
                    }
                model.pages[pages.last()]
                    ?.text("nextCursor")
                    ?.takeIf { it.isNotBlank() }
                    ?.let { cursor ->
                        item {
                            TextButton(
                                onClick = { pages = pages + "$feed&before=${query(cursor)}" },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text("More updates")
                            }
                        }
                    }
            }
            "About" -> {
                item {
                    ProfileSection("About") {
                        Text(
                            c.text("description").ifBlank {
                                "This company is completing its introduction."
                            }
                        )
                        ProfileFact("Based in", c.text("location"))
                        ProfileFact("Founded", c.text("established"))
                        ProfileFact("Company size", c.text("employee_count"))
                        ProfileFact(
                            "Services",
                            c.optJSONArray("services").strings().joinToString(" · "),
                        )
                        ProfileFact(
                            "Areas served",
                            c.optJSONArray("service_areas").strings().joinToString(", "),
                        )
                        c.text("website")
                            .takeIf { it.startsWith("https://") || it.startsWith("http://") }
                            ?.let { link ->
                                TextButton(onClick = { uri.openUri(link) }) {
                                    Text("Visit website")
                                }
                            }
                    }
                }
                item {
                    ProfileSection("Achievements", if (edit) ({ add("achievement") }) else null) {
                        data.optJSONArray("achievements").objects().forEach { a ->
                            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Outlined.EmojiEvents, null, tint = Orange)
                                    Spacer(Modifier.width(8.dp))
                                    Text(
                                        a.text("title"),
                                        Modifier.weight(1f),
                                        style = MaterialTheme.typography.titleSmall,
                                    )
                                    if (edit)
                                        IconButton(onClick = { add("achievement", a) }) {
                                            Icon(Icons.Outlined.Edit, "Edit achievement")
                                        }
                                }
                                Text(
                                    listOf(a.text("issuer"), a.text("year"))
                                        .filter { it.isNotBlank() }
                                        .joinToString(" · "),
                                    color = Muted,
                                    style = MaterialTheme.typography.bodySmall,
                                )
                                if (a.text("description").isNotBlank()) Text(a.text("description"))
                                if (edit)
                                    TextButton(
                                        onClick = { remove = "achievements" to a.text("id") }
                                    ) {
                                        Text("Remove achievement")
                                    }
                            }
                        }
                        if (data.optJSONArray("achievements").objects().isEmpty())
                            Text("Awards, milestones, and credentials belong here.", color = Muted)
                    }
                }
            }
            "Portfolio" -> {
                if (edit)
                    item {
                        ConnectOutlinedButton(
                            onClick = { add("project") },
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                        ) {
                            Icon(Icons.Outlined.Add, null)
                            Text("Add project")
                        }
                    }
                val projects = data.optJSONArray("projects").objects()
                items(projects, key = { it.text("id") }) { p ->
                    ProfileSection(p.text("name"), if (edit) ({ add("project", p) }) else null) {
                        if (p.text("image_url").isNotBlank())
                            AsyncImage(
                                mediaUrl(model, p.text("image_url")),
                                p.text("name"),
                                Modifier.fillMaxWidth().height(180.dp),
                                contentScale = ContentScale.Crop,
                            )
                        Text(
                            listOf(p.text("location"), p.text("size"), p.text("completed_year"))
                                .filter { it.isNotBlank() }
                                .joinToString(" · "),
                            color = Muted,
                        )
                        Text(p.text("description"))
                        p.text("url")
                            .takeIf { it.startsWith("https://") || it.startsWith("http://") }
                            ?.let { url ->
                                TextButton(onClick = { uri.openUri(url) }) { Text("View project") }
                            }
                        if (edit)
                            TextButton(onClick = { remove = "portfolio" to p.text("id") }) {
                                Text("Remove project")
                            }
                    }
                }
                if (projects.isEmpty())
                    item {
                        Text(
                            "Great work deserves a place of its own.",
                            Modifier.padding(24.dp),
                            color = Muted,
                        )
                    }
            }
            "People" -> {
                if (edit)
                    item {
                        ConnectOutlinedButton(
                            onClick = { sheet = "employees" },
                            modifier = Modifier.padding(horizontal = 16.dp),
                        ) {
                            Text("Manage employee access")
                        }
                    }
                items(data.optJSONArray("team").objects(), key = { it.text("id") }) { p ->
                    Row(
                        Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        CompanyAvatar(p)
                        Column {
                            Text(p.text("name"), style = MaterialTheme.typography.titleSmall)
                            Text(
                                p.text("title").ifBlank { "Team member" },
                                color = Muted,
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                    }
                }
            }
            "Reviews" -> {
                val r = model.pages["$reviews?page=$reviewPage"]
                item {
                    ProfileSection("Customer experiences") {
                        val rating = r?.optJSONObject("rating")
                        Text(
                            if ((rating?.optInt("count") ?: 0) > 0)
                                "★ ${rating?.optDouble("average")} from ${rating?.optInt("count")} reviews"
                            else "Be the first to share your experience.",
                            style = MaterialTheme.typography.titleMedium,
                        )
                        if (!own && r?.optBoolean("affiliated") != true)
                            ConnectButton(
                                onClick = {
                                    if (!model.signedIn) onSignIn()
                                    else {
                                        entry = r?.optJSONObject("mine")
                                        sheet = "review"
                                    }
                                }
                            ) {
                                Text(
                                    if (r?.optJSONObject("mine") != null) "Edit your review"
                                    else "Write a review"
                                )
                            }
                    }
                }
                items(r?.optJSONArray("reviews").objects(), key = { it.text("id") }) { review ->
                    ProfileSection(review.text("title")) {
                        Text(
                            "★".repeat(review.optInt("rating")) +
                                " · " +
                                review.text("reviewer_name"),
                            color = Muted,
                            style = MaterialTheme.typography.labelMedium,
                        )
                        Text(review.text("body"))
                        if (review.text("reply").isNotBlank())
                            Surface(color = Pale, shape = RoundedCornerShape(12.dp)) {
                                Column(Modifier.padding(12.dp)) {
                                    Text(
                                        "${c.text("name")} replied",
                                        style = MaterialTheme.typography.labelMedium,
                                    )
                                    Text(review.text("reply"))
                                }
                            }
                    }
                }
                item {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        TextButton(enabled = reviewPage > 1, onClick = { reviewPage-- }) {
                            Text("Previous")
                        }
                        TextButton(
                            enabled = r?.text("nextPage")?.isNotBlank() == true,
                            onClick = { reviewPage++ },
                        ) {
                            Text("Next")
                        }
                    }
                }
            }
        }
    }
    when (sheet) {
        "profile" -> EditCompany(model, c) { sheet = "" }
        "employees" -> EmployeeAccess(model) { sheet = "" }
        "logo",
        "cover" -> CompanyPhoto(model, c, sheet) { sheet = "" }
        "project",
        "achievement" -> PortfolioForm(model, entry, sheet == "achievement") { sheet = "" }
        "publish" ->
            PublicationComposer(model, null, { sheet = "" }) {
                model.load(feed, true)
                model.load("/feed?scope=all", true)
            }
        "drafts" -> PublicationDrafts(model) { sheet = "" }
        "review" ->
            ReviewForm(model, c, entry) {
                sheet = ""
                model.load("$reviews?page=$reviewPage", true)
                model.load("/companies/$id", true)
            }
    }
    remove?.let { (kind, key) ->
        AlertDialog(
            onDismissRequest = { remove = null },
            title = { Text("Remove from your profile?") },
            text = { Text("This entry will be deleted.") },
            confirmButton = {
                TextButton(
                    enabled = !model.busy,
                    onClick = {
                        model.perform({
                            model.jsonRequest("DELETE", "/companies/current/$kind/$key")
                        }) {
                            remove = null
                            model.refreshCompany()
                        }
                    },
                ) {
                    Text("Remove")
                }
            },
            dismissButton = { TextButton(onClick = { remove = null }) { Text("Keep") } },
        )
    }
}

@Composable
private fun ProfileSection(
    title: String,
    edit: (() -> Unit)? = null,
    body: @Composable ColumnScope.() -> Unit,
) {
    Card(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(15.dp),
    ) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                if (edit != null)
                    IconButton(onClick = edit) { Icon(Icons.Outlined.Edit, "Edit $title") }
            }
            body()
        }
    }
}

@Composable
private fun ProfileFact(label: String, value: String) {
    if (value.isNotBlank())
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(label, style = MaterialTheme.typography.labelMedium, color = Muted)
            Text(value)
        }
}

@Composable
private fun ReviewForm(
    model: CommunityModel,
    c: JSONObject,
    review: JSONObject?,
    close: () -> Unit,
) {
    var rating by rememberSaveable { mutableIntStateOf(review?.optInt("rating") ?: 0) }
    var title by rememberSaveable { mutableStateOf(review?.text("title").orEmpty()) }
    var body by rememberSaveable { mutableStateOf(review?.text("body").orEmpty()) }
    var date by rememberSaveable {
        mutableStateOf(review?.text("experience_date")?.take(10).orEmpty())
    }
    var confirmed by rememberSaveable { mutableStateOf(false) }
    var leaving by remember { mutableStateOf(false) }
    WorkSheet(
        model,
        "Your experience with ${c.text("name")}",
        { leaving = true },
        "Save review",
        rating > 0 &&
            title.trim().length >= 3 &&
            body.trim().length >= 20 &&
            confirmed &&
            date.matches(Regex("\\d{4}-\\d{2}-\\d{2}")),
        save = {
            model.perform({
                model.jsonRequest(
                    "PUT",
                    "/companies/${c.text("id")}/reviews/mine",
                    JSONObject()
                        .put("rating", rating)
                        .put("title", title)
                        .put("body", body)
                        .put("experienceDate", date)
                        .put("customerExperience", true),
                )
            }) {
                close()
            }
        },
    ) {
        Text("Tell the story only you can tell.", style = MaterialTheme.typography.headlineSmall)
        Text("Share an honest, first-hand customer experience.", color = Muted)
        Row {
            (1..5).forEach { n ->
                IconButton(onClick = { rating = n }) {
                    Icon(
                        if (n <= rating) Icons.Outlined.Star else Icons.Outlined.StarBorder,
                        "$n stars",
                        tint = Orange,
                        modifier = Modifier.size(32.dp),
                    )
                }
            }
        }
        WorkField("A few words to sum it up", title, { title = it }, limit = 120)
        WorkField("Your experience", body, { body = it }, lines = 5, limit = 3000)
        WorkField("Date of experience", date, { date = it }, limit = 10, hint = "YYYY-MM-DD")
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(confirmed, { confirmed = it })
            Text(
                "This is my own customer experience, and I don’t work for this company.",
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
    if (leaving) ConfirmLeave(true, close) { leaving = false }
}
