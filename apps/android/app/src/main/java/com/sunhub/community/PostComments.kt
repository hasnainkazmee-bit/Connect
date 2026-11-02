package com.sunhub.community

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject

private fun commentDeleted(comment: JSONObject) =
    comment.text("deleted_at").let { it.isNotBlank() && it != "null" }

private fun commentName(comment: JSONObject): String =
    comment.optJSONObject("company")?.text("name").orEmpty().ifBlank { comment.text("author_name") }

private fun commentRoot(comment: JSONObject): String =
    comment.text("parent_id").takeIf { it.isNotBlank() && it != "null" } ?: comment.text("id")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PostCommentsSheet(
    model: CommunityModel,
    id: String,
    close: () -> Unit,
    signIn: () -> Unit,
    savedDraft: String?,
    saveDraft: (String, String?) -> Unit,
) {
    val base = "/posts/$id/comments"
    val scope = rememberCoroutineScope()
    val list = rememberLazyListState()
    val composerFocus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    var paths by rememberSaveable(id) { mutableStateOf(listOf(base)) }
    val pages = remember(id) { mutableStateMapOf<String, JSONObject>() }
    var revision by remember(id) { mutableIntStateOf(0) }
    var loading by remember(id) { mutableStateOf(false) }
    var saving by remember(id) { mutableStateOf(false) }
    var loadError by remember(id) { mutableStateOf<String?>(null) }
    var writeError by remember(id) { mutableStateOf<String?>(null) }
    var draft by
        rememberSaveable(id) {
            mutableStateOf(savedDraft?.let { JSONObject(it).text("body") }.orEmpty())
        }
    var replyJson by
        rememberSaveable(id) {
            mutableStateOf(
                savedDraft?.let {
                    JSONObject(it).text("target").takeIf { value ->
                        value.isNotBlank() && value != "null"
                    }
                }
            )
        }
    var scrollToCreated by remember(id) { mutableStateOf<String?>(null) }
    var deleteJson by remember(id) { mutableStateOf<String?>(null) }
    val expanded = remember(id) { mutableStateMapOf<String, Boolean>() }
    val addedReplies = remember(id) { mutableStateMapOf<String, List<JSONObject>>() }
    val replyTo = replyJson?.let(::JSONObject)
    val roots =
        paths
            .flatMap { pages[it]?.optJSONArray("comments").objects() }
            .distinctBy { it.text("id") }
            .sortedBy { it.optLong("sequence") }
    val next = pages[paths.last()]?.text("nextCursor")?.takeIf { it.isNotBlank() && it != "null" }
    val canComment = model.company != null && !model.individual
    LaunchedEffect(paths, revision, model.company?.text("id")) {
        loading = true
        loadError = null
        try {
            // Rebuild cursor boundaries after a new root is added; otherwise refreshing the
            // newest page can skip the root that moved across an older page's old boundary.
            var requestPath: String? = base
            paths.forEach { pageKey ->
                val request = requestPath
                if (request == null) pages.remove(pageKey)
                else {
                    val response = model.fetchJson(request)
                    pages[pageKey] = response
                    requestPath =
                        response
                            .text("nextCursor")
                            .takeIf { it.isNotBlank() }
                            ?.let { "$base?before=${query(it)}" }
                }
            }
            scrollToCreated?.let { target ->
                val all =
                    paths
                        .flatMap { pages[it]?.optJSONArray("comments").objects() }
                        .distinctBy { it.text("id") }
                        .sortedBy { it.optLong("sequence") }
                val index = all.indexOfFirst { it.text("id") == target }
                val hasEarlier =
                    pages[paths.last()]?.text("nextCursor")?.let {
                        it.isNotBlank() && it != "null"
                    } == true
                if (index >= 0) {
                    withFrameNanos {}
                    list.animateScrollToItem(index + if (hasEarlier) 1 else 0)
                }
                scrollToCreated = null
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            loadError = socialError(e)
        } finally {
            loading = false
        }
    }
    fun reply(comment: JSONObject) {
        replyJson = comment.toString()
        saveDraft(draft, replyJson)
        writeError = null
        expanded[commentRoot(comment)] = true
    }
    LaunchedEffect(replyJson) {
        if (replyJson != null && canComment) {
            composerFocus.requestFocus()
            keyboard?.show()
        }
    }
    fun submit() {
        if (!canComment || saving || draft.isBlank()) return
        val body = draft.trim()
        val target = replyTo
        val companyId = model.company?.text("id")
        saving = true
        writeError = null
        scope.launch {
            try {
                val updated =
                    model.jsonRequest(
                        "POST",
                        base,
                        JSONObject().put("body", body).apply {
                            target?.let { put("parentId", it.text("id")) }
                        },
                    )
                if (model.company?.text("id") != companyId) return@launch
                applySocialPost(model, updated, SocialPostChange.Comments, companyId)
                updated.optJSONObject("created_comment")?.let { created ->
                    val parent =
                        created.text("parent_id").takeIf { it.isNotBlank() && it != "null" }
                    if (parent != null) {
                        addedReplies[parent] =
                            (addedReplies[parent].orEmpty() + created).distinctBy { it.text("id") }
                        expanded[parent] = true
                    } else scrollToCreated = created.text("id")
                }
                // Clear only after success. A network or permission failure keeps the full reply.
                draft = ""
                replyJson = null
                saveDraft("", null)
                revision++
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                writeError = socialError(e)
            } finally {
                saving = false
            }
        }
    }
    ModalBottomSheet(
        onDismissRequest = { if (!saving) close() },
        sheetState =
            rememberModalBottomSheetState(
                skipPartiallyExpanded = true,
                confirmValueChange = { it != SheetValue.Hidden || !saving },
            ),
        containerColor = Color.White,
        modifier = Modifier.fillMaxHeight(.94f).testTag("comments-sheet"),
    ) {
        Column(Modifier.fillMaxWidth().fillMaxHeight().imePadding()) {
            Box(Modifier.padding(horizontal = 16.dp)) {
                SheetHeading("Comments", { if (!saving) close() })
            }
            LazyColumn(
                state = list,
                modifier = Modifier.weight(1f).fillMaxWidth().testTag("comments-list"),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                if (next != null)
                    item(key = "earlier") {
                        TextButton(
                            onClick = { paths = paths + "$base?before=${query(next)}" },
                            enabled = !loading,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Earlier comments")
                        }
                    }
                if (loadError != null)
                    item(key = "load-error") {
                        Text(loadError!!, color = MaterialTheme.colorScheme.error)
                        TextButton(onClick = { revision++ }) { Text("Try again") }
                    }
                if (loading && roots.isEmpty())
                    item(key = "loading") {
                        Box(
                            Modifier.fillMaxWidth().padding(32.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            CircularProgressIndicator(Modifier.size(26.dp))
                        }
                    }
                if (!loading && roots.isEmpty() && loadError == null)
                    item(key = "empty") {
                        Text(
                            "No comments yet.",
                            Modifier.padding(vertical = 12.dp),
                            color = Muted,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                items(roots, key = { it.text("id") }) { comment ->
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        CommentRow(
                            model,
                            comment,
                            false,
                            canComment && !saving,
                            ::reply,
                            { deleteJson = it.toString() },
                            { close() },
                        )
                        val rootId = comment.text("id")
                        val count = comment.optInt("reply_count")
                        if (count > 0 || addedReplies[rootId].orEmpty().isNotEmpty()) {
                            TextButton(
                                onClick = { expanded[rootId] = expanded[rootId] != true },
                                modifier = Modifier.padding(start = 42.dp),
                            ) {
                                Icon(
                                    if (expanded[rootId] == true) Icons.Outlined.ExpandLess
                                    else Icons.Outlined.SubdirectoryArrowRight,
                                    null,
                                    Modifier.size(18.dp),
                                )
                                Spacer(Modifier.width(4.dp))
                                Text(
                                    if (expanded[rootId] == true) "Hide replies"
                                    else "View $count ${if (count == 1) "reply" else "replies"}"
                                )
                            }
                        }
                        if (expanded[rootId] == true)
                            CommentReplies(
                                model,
                                id,
                                rootId,
                                revision,
                                addedReplies[rootId].orEmpty(),
                                canComment && !saving,
                                ::reply,
                                { deleteJson = it.toString() },
                                close,
                            )
                    }
                }
            }
            HorizontalDivider(color = Ink.copy(alpha = .08f))
            Surface(color = Color.White) {
                Column(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    when {
                        !model.signedIn ->
                            ConnectButton(
                                onClick = {
                                    close()
                                    signIn()
                                },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text("Sign in to join the conversation")
                            }
                        !canComment ->
                            Text(
                                "Companies can join the conversation. You can contact a company from its profile.",
                                color = Muted,
                                style = MaterialTheme.typography.bodySmall,
                            )
                        else -> {
                            if (replyTo != null)
                                Row(
                                    Modifier.fillMaxWidth(),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(
                                        "Replying to ${commentName(replyTo)}",
                                        Modifier.weight(1f),
                                        style = MaterialTheme.typography.labelMedium,
                                    )
                                    IconButton(
                                        onClick = {
                                            replyJson = null
                                            saveDraft(draft, null)
                                        },
                                        enabled = !saving,
                                        modifier = Modifier.size(48.dp),
                                    ) {
                                        Icon(
                                            Icons.Outlined.Close,
                                            "Cancel reply",
                                            Modifier.size(18.dp),
                                        )
                                    }
                                }
                            if (writeError != null)
                                Text(
                                    writeError!!,
                                    color = MaterialTheme.colorScheme.error,
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                model.company?.let { CompanyAvatar(it, 32) }
                                Surface(
                                    color = Pale,
                                    shape = ConnectCardShape,
                                    modifier = Modifier.weight(1f),
                                ) {
                                    Row(
                                        Modifier.fillMaxWidth().heightIn(min = 48.dp),
                                        verticalAlignment = Alignment.Bottom,
                                    ) {
                                        BasicTextField(
                                            draft,
                                            {
                                                draft = it.take(1500)
                                                saveDraft(draft, replyJson)
                                            },
                                            modifier =
                                                Modifier.weight(1f)
                                                    .padding(
                                                        start = 16.dp,
                                                        top = 14.dp,
                                                        bottom = 14.dp,
                                                    )
                                                    .focusRequester(composerFocus)
                                                    .testTag("comment-draft"),
                                            textStyle =
                                                MaterialTheme.typography.bodyMedium.copy(
                                                    color = Ink
                                                ),
                                            cursorBrush = SolidColor(Ink),
                                            maxLines = 5,
                                            enabled = !saving,
                                            keyboardOptions =
                                                KeyboardOptions(
                                                    capitalization =
                                                        KeyboardCapitalization.Sentences
                                                ),
                                            decorationBox = { input ->
                                                Box {
                                                    if (draft.isEmpty())
                                                        Text(
                                                            if (replyTo == null) "Add a comment…"
                                                            else "Write a reply…",
                                                            color = Muted,
                                                            style =
                                                                MaterialTheme.typography.bodyMedium,
                                                        )
                                                    input()
                                                }
                                            },
                                        )
                                        IconButton(
                                            onClick = ::submit,
                                            enabled = !saving && draft.isNotBlank(),
                                            modifier = Modifier.size(48.dp).testTag("send-comment"),
                                        ) {
                                            if (saving)
                                                CircularProgressIndicator(
                                                    Modifier.size(20.dp),
                                                    strokeWidth = 2.dp,
                                                )
                                            else
                                                Icon(
                                                    Icons.AutoMirrored.Outlined.Send,
                                                    if (replyTo == null) "Send comment"
                                                    else "Send reply",
                                                    tint = if (draft.isBlank()) Muted else Ink,
                                                    modifier = Modifier.size(20.dp),
                                                )
                                        }
                                    }
                                }
                            }
                            if (draft.length > 1350)
                                Text(
                                    "${draft.length} / 1,500",
                                    color = Muted,
                                    style = MaterialTheme.typography.labelSmall,
                                )
                        }
                    }
                }
            }
        }
    }
    deleteJson?.let { raw ->
        val comment = JSONObject(raw)
        AlertDialog(
            onDismissRequest = { if (!saving) deleteJson = null },
            title = { Text("Delete this comment?") },
            text = { Text("Replies will stay in the conversation.") },
            confirmButton = {
                TextButton(
                    enabled = !saving,
                    onClick = {
                        val companyId = model.company?.text("id")
                        saving = true
                        writeError = null
                        scope.launch {
                            try {
                                val updated =
                                    model.jsonRequest(
                                        "DELETE",
                                        "$base/${comment.text("id")}",
                                        JSONObject(),
                                    )
                                if (model.company?.text("id") != companyId) return@launch
                                applySocialPost(
                                    model,
                                    updated,
                                    SocialPostChange.Comments,
                                    companyId,
                                )
                                addedReplies.keys.toList().forEach { key ->
                                    addedReplies[key] =
                                        addedReplies[key].orEmpty().filter {
                                            it.text("id") != comment.text("id")
                                        }
                                }
                                deleteJson = null
                                revision++
                                if (replyTo?.text("id") == comment.text("id")) {
                                    replyJson = null
                                    saveDraft(draft, null)
                                }
                            } catch (e: CancellationException) {
                                throw e
                            } catch (e: Exception) {
                                writeError = socialError(e)
                                deleteJson = null
                            } finally {
                                saving = false
                            }
                        }
                    },
                ) {
                    Text("Delete", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(enabled = !saving, onClick = { deleteJson = null }) {
                    Text("Keep comment")
                }
            },
        )
    }
}

@Composable
private fun CommentReplies(
    model: CommunityModel,
    postId: String,
    rootId: String,
    revision: Int,
    added: List<JSONObject>,
    canReply: Boolean,
    reply: (JSONObject) -> Unit,
    delete: (JSONObject) -> Unit,
    close: () -> Unit,
) {
    val base = "/posts/$postId/comments/$rootId/replies"
    var paths by rememberSaveable(rootId) { mutableStateOf(listOf(base)) }
    val pages = remember(rootId) { mutableStateMapOf<String, JSONObject>() }
    var loading by remember(rootId) { mutableStateOf(false) }
    var error by remember(rootId) { mutableStateOf<String?>(null) }
    var retry by remember(rootId) { mutableIntStateOf(0) }
    LaunchedEffect(paths, revision, retry) {
        loading = true
        error = null
        try {
            paths.forEach { pages[it] = model.fetchJson(it) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = socialError(e)
        } finally {
            loading = false
        }
    }
    val replies =
        paths
            .flatMap { pages[it]?.optJSONArray("comments").objects() }
            .distinctBy { it.text("id") }
            .sortedBy { it.optLong("sequence") }
    val recent = added.filter { new -> replies.none { it.text("id") == new.text("id") } }
    val next = pages[paths.last()]?.text("nextCursor")?.takeIf { it.isNotBlank() && it != "null" }
    Column(
        Modifier.padding(start = 30.dp).fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        replies.forEach { item ->
            key(item.text("id")) { CommentRow(model, item, true, canReply, reply, delete, close) }
        }
        if (loading)
            Box(Modifier.fillMaxWidth().padding(12.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(Modifier.size(20.dp))
            }
        if (error != null) {
            Text(
                error!!,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
            )
            TextButton(onClick = { retry++ }) { Text("Try again") }
        }
        if (next != null)
            TextButton(
                onClick = { paths = paths + "$base?after=${query(next)}" },
                enabled = !loading,
            ) {
                Text("More replies")
            }
        recent.forEach { item ->
            key(item.text("id")) { CommentRow(model, item, true, canReply, reply, delete, close) }
        }
    }
}

@Composable
private fun CommentRow(
    model: CommunityModel,
    comment: JSONObject,
    nested: Boolean,
    canReply: Boolean,
    reply: (JSONObject) -> Unit,
    delete: (JSONObject) -> Unit,
    close: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    val company = comment.optJSONObject("company") ?: JSONObject()
    val deleted = commentDeleted(comment)
    Row(
        Modifier.fillMaxWidth().testTag("comment-${comment.text("id")}"),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            Modifier.padding(top = 2.dp).clickable(enabled = !deleted) {
                close()
                model.profile(company.text("id"))
            }
        ) {
            CompanyAvatar(company, if (nested) 30 else 36)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Surface(color = if (nested) Color(0xFFF6F8FA) else Pale, shape = ConnectCardShape) {
                Column(
                    Modifier.fillMaxWidth().padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    if (!deleted) {
                        Text(
                            commentName(comment),
                            Modifier.clickable {
                                close()
                                model.profile(company.text("id"))
                            },
                            fontWeight = FontWeight.SemiBold,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        comment
                            .text("author_name")
                            .takeIf { it.isNotBlank() && it != commentName(comment) }
                            ?.let {
                                Text(it, style = MaterialTheme.typography.labelSmall, color = Muted)
                            }
                        comment
                            .text("reply_to_name")
                            .takeIf { it.isNotBlank() && it != "null" }
                            ?.let {
                                Text(
                                    "Replying to $it",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = Muted,
                                )
                            }
                    }
                    Text(
                        if (deleted) "This comment was deleted." else comment.text("body"),
                        color = if (deleted) Muted else Ink,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
            if (!deleted)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (canReply)
                        TextButton(
                            onClick = { reply(comment) },
                            modifier = Modifier.heightIn(min = 44.dp),
                        ) {
                            Text("Reply")
                        }
                    val time =
                        runCatching {
                                android.text.format.DateUtils.getRelativeTimeSpanString(
                                        java.time.Instant.parse(comment.text("created_at"))
                                            .toEpochMilli(),
                                        System.currentTimeMillis(),
                                        60_000,
                                    )
                                    .toString()
                            }
                            .getOrDefault("")
                    Text(
                        time,
                        Modifier.weight(1f).padding(start = if (canReply) 0.dp else 8.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = Muted,
                    )
                    if (comment.optBoolean("can_delete"))
                        Box {
                            IconButton(onClick = { menu = true }, modifier = Modifier.size(44.dp)) {
                                Icon(
                                    Icons.Outlined.MoreHoriz,
                                    "Comment options",
                                    Modifier.size(20.dp),
                                )
                            }
                            DropdownMenu(menu, { menu = false }) {
                                DropdownMenuItem(
                                    text = { Text("Delete comment") },
                                    onClick = {
                                        menu = false
                                        delete(comment)
                                    },
                                )
                            }
                        }
                }
        }
    }
}
