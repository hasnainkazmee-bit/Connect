package com.sunhub.community

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import java.util.UUID
import kotlinx.coroutines.delay
import org.json.JSONObject

@Composable
internal fun PersonalInbox(model: CommunityModel, open: (JSONObject) -> Unit) {
    val lifecycle = LocalLifecycleOwner.current
    var search by rememberSaveable { mutableStateOf("") }
    var all by rememberSaveable { mutableStateOf(true) }
    var page by rememberSaveable { mutableIntStateOf(1) }
    val path = "/companies?q=${query(search)}&page=$page"
    LaunchedEffect(path) {
        if (model.individual) {
            delay(200)
            model.load(path)
        }
    }
    LaunchedEffect(model.company?.text("id"), lifecycle) {
        lifecycle.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                model.load("/personal-inbox", true)
                delay(5000)
            }
        }
    }
    val threads = model.pages["/personal-inbox"]?.optJSONArray("threads").objects()
    Column {
        Text(
            if (model.individual) "A conversation away." else "Customer conversations",
            Modifier.padding(16.dp),
            style = MaterialTheme.typography.titleLarge,
        )
        OutlinedTextField(
            search,
            {
                search = it
                page = 1
            },
            placeholder = { Text(if (model.individual) "Search companies…" else "Search people…") },
            leadingIcon = { Icon(Icons.Outlined.Search, null) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            shape = RoundedCornerShape(12.dp),
        )
        Row(
            Modifier.padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            FilterChip(
                all,
                { all = true },
                label = { Text(if (model.individual) "All companies" else "All messages") },
            )
            FilterChip(
                !all,
                { all = false },
                label = { Text(if (model.individual) "My chats" else "Requests") },
            )
        }
        val companies =
            if (model.individual && all) model.pages[path]?.optJSONArray("companies").objects()
            else
                threads.filter {
                    (all || model.individual || it.text("status") == "pending") &&
                        (if (model.individual) it.getJSONObject("company").text("name")
                            else it.text("person_name"))
                            .contains(search, true)
                }
        LazyColumn(Modifier.weight(1f)) {
            items(companies, key = { it.text("id") }) { item ->
                val thread =
                    if (item.has("person_name")) item
                    else threads.find { it.getJSONObject("company").text("id") == item.text("id") }
                val company = if (item.has("company")) item.getJSONObject("company") else item
                val name =
                    if (model.individual) company.text("name")
                    else thread?.text("person_name").orEmpty()
                Row(
                    Modifier.fillMaxWidth()
                        .clickable { if (model.individual) model.chat(company) else open(thread!!) }
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    CompanyAvatar(if (model.individual) company else JSONObject().put("name", name))
                    Column(Modifier.weight(1f)) {
                        Text(name, style = MaterialTheme.typography.titleSmall)
                        Text(
                            thread?.text("last_message") ?: company.text("location"),
                            color = Muted,
                            style = MaterialTheme.typography.bodySmall,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    if (thread?.text("status") == "pending")
                        Text("Request", color = Muted, style = MaterialTheme.typography.labelSmall)
                    else if ((thread?.optInt("unread") ?: 0) > 0)
                        Badge { Text(thread!!.optInt("unread").toString()) }
                }
            }
            if (companies.isEmpty())
                item {
                    Text(
                        if (search.isNotBlank()) "No matches yet."
                        else "New conversations will appear here.",
                        Modifier.padding(24.dp),
                        color = Muted,
                    )
                }
            if (model.individual && all && (model.pages[path]?.optInt("total") ?: 0) > 24)
                item {
                    Row(
                        Modifier.fillMaxWidth().padding(12.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        TextButton(enabled = page > 1, onClick = { page-- }) { Text("Previous") }
                        Text(page.toString())
                        TextButton(
                            enabled = page * 24 < (model.pages[path]?.optInt("total") ?: 0),
                            onClick = { page++ },
                        ) {
                            Text("Next")
                        }
                    }
                }
        }
    }
}

@Composable
internal fun PersonalChat(
    model: CommunityModel,
    company: JSONObject? = null,
    threadId: String? = null,
) {
    val lifecycle = LocalLifecycleOwner.current
    val individual = model.individual
    val threads = model.pages["/personal-inbox"]?.optJSONArray("threads").objects()
    val id =
        threadId
            ?: threads
                .find { it.getJSONObject("company").text("id") == company?.text("id") }
                ?.text("id")
    val path = id?.let { "/personal-inbox/$it" }
    var text by rememberSaveable(company?.text("id"), threadId) { mutableStateOf("") }
    var clientId by rememberSaveable { mutableStateOf(UUID.randomUUID().toString()) }
    var lastText by rememberSaveable { mutableStateOf("") }
    var older by remember { mutableStateOf(emptyList<JSONObject>()) }
    var before by remember { mutableStateOf<String?>(null) }
    var loadedOlder by remember { mutableStateOf(false) }
    val scroll = rememberLazyListState()
    LaunchedEffect(path, lifecycle) {
        lifecycle.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                model.load("/personal-inbox", true)
                if (path != null) model.load(path, true)
                delay(4000)
            }
        }
    }
    val data = path?.let { model.pages[it] }
    val thread = data?.optJSONObject("thread")
    val messages = (older + data?.optJSONArray("messages").objects()).distinctBy { it.text("id") }
    val status = thread?.text("status")
    LaunchedEffect(messages.lastOrNull()?.text("id")) {
        if (messages.isNotEmpty()) scroll.animateScrollToItem(messages.size)
    }
    Column(Modifier.fillMaxSize().background(Color.White)) {
        if (thread != null)
            Text(
                if (individual) thread.getJSONObject("company").text("name")
                else thread.text("person_name"),
                Modifier.fillMaxWidth().background(Pale).padding(16.dp),
                style = MaterialTheme.typography.titleMedium,
            )
        LazyColumn(
            state = scroll,
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                val cursor =
                    if (loadedOlder) before
                    else data?.text("nextCursor")?.takeIf { it.isNotBlank() }
                if (cursor != null)
                    TextButton(
                        enabled = !model.busy,
                        onClick = {
                            model.perform({ model.fetchJson("$path?before=$cursor") }) {
                                older = it.optJSONArray("messages").objects() + older
                                before = it.text("nextCursor").takeIf { v -> v.isNotBlank() }
                                loadedOlder = true
                            }
                        },
                    ) {
                        Text("Earlier messages")
                    }
            }
            if (data == null && id == null)
                item {
                    Column(
                        Modifier.fillMaxWidth().padding(vertical = 50.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(15.dp),
                    ) {
                        company?.let { CompanyAvatar(it, 64) }
                        Text(
                            "Say hello to ${company?.text("name").orEmpty()}.",
                            style = MaterialTheme.typography.headlineSmall,
                        )
                        Text(
                            "Send an introduction. Keep chatting once the company accepts.",
                            color = Muted,
                        )
                    }
                }
            items(messages, key = { it.text("id") }) { m ->
                val own = m.text("sender_kind") == if (individual) "individual" else "company"
                Column(
                    Modifier.fillMaxWidth(),
                    horizontalAlignment = if (own) Alignment.End else Alignment.Start,
                ) {
                    Text(
                        m.text("author_name"),
                        Modifier.padding(bottom = 4.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = Muted,
                    )
                    Surface(
                        color = if (own) Pale else Color(0xFFF4F5F7),
                        shape = RoundedCornerShape(14.dp),
                        modifier = Modifier.widthIn(max = 300.dp),
                    ) {
                        Text(
                            m.text("body"),
                            Modifier.padding(12.dp),
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                    val time =
                        runCatching {
                                java.time.Instant.parse(m.text("created_at"))
                                    .atZone(java.time.ZoneId.systemDefault())
                                    .format(java.time.format.DateTimeFormatter.ofPattern("h:mm a"))
                            }
                            .getOrDefault("")
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(time, style = MaterialTheme.typography.labelSmall, color = Muted)
                        if (own)
                            Icon(
                                if (
                                    m.optLong("sequence") <=
                                        (data?.optLong("peerReadSequence") ?: 0)
                                )
                                    Icons.Outlined.DoneAll
                                else Icons.Outlined.Done,
                                null,
                                Modifier.padding(start = 4.dp).size(14.dp),
                                tint = Muted,
                            )
                    }
                }
            }
        }
        model.error?.let {
            Text(
                it,
                Modifier.padding(horizontal = 16.dp),
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
            )
        }
        when (status) {
            "pending" ->
                if (individual)
                    Text(
                        "Request sent. You can chat after the company accepts.",
                        Modifier.fillMaxWidth().background(Pale).padding(20.dp),
                        color = Muted,
                    )
                else
                    Column(Modifier.fillMaxWidth().background(Pale).padding(16.dp)) {
                        Text(
                            "Start this conversation?",
                            style = MaterialTheme.typography.titleSmall,
                        )
                        Text(
                            "${thread?.text("person_name")} wants to talk to your company.",
                            style = MaterialTheme.typography.bodySmall,
                            color = Muted,
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            TextButton(
                                enabled = !model.busy,
                                onClick = {
                                    model.mutate(
                                        "$path/respond",
                                        JSONObject().put("accept", false),
                                    ) {
                                        model.load(path!!, true)
                                        model.load("/personal-inbox", true)
                                    }
                                },
                            ) {
                                Text("Decline")
                            }
                            Button(
                                enabled = !model.busy,
                                onClick = {
                                    model.mutate(
                                        "$path/respond",
                                        JSONObject().put("accept", true),
                                    ) {
                                        model.load(path!!, true)
                                        model.load("/personal-inbox", true)
                                    }
                                },
                            ) {
                                Text("Accept")
                            }
                        }
                    }
            "declined" ->
                Text("This message request was declined.", Modifier.padding(20.dp), color = Muted)
            else ->
                if (
                    status == "accepted" ||
                        individual && id == null && model.pages["/personal-inbox"] != null
                )
                    Row(
                        Modifier.fillMaxWidth().padding(12.dp),
                        verticalAlignment = Alignment.Bottom,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        OutlinedTextField(
                            text,
                            { text = it.take(if (id == null) 2000 else 4000) },
                            placeholder = {
                                Text(if (id == null) "Introduce yourself…" else "Write a message…")
                            },
                            modifier = Modifier.weight(1f),
                            maxLines = 5,
                            shape = RoundedCornerShape(16.dp),
                        )
                        FilledIconButton(
                            enabled = !model.busy && text.isNotBlank(),
                            onClick = {
                                if (text != lastText) {
                                    clientId = UUID.randomUUID().toString()
                                    lastText = text
                                }
                                val b = JSONObject().put("body", text).put("clientId", clientId)
                                if (id == null) b.put("companyId", company!!.text("id"))
                                model.mutate(
                                    if (id == null) "/personal-inbox" else "$path/messages",
                                    b,
                                ) {
                                    text = ""
                                    lastText = ""
                                    model.load("/personal-inbox", true)
                                    if (path != null) model.load(path, true)
                                }
                            },
                        ) {
                            Icon(
                                Icons.AutoMirrored.Outlined.Send,
                                if (id == null) "Send message request" else "Send message",
                            )
                        }
                    }
        }
    }
}
