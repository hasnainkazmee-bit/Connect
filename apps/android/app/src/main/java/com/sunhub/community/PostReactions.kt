package com.sunhub.community

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sunhub.core.CoreException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

internal fun socialError(error: Exception): String =
    when (error) {
        is CoreException.Api -> error.detail
        is CoreException.Invalid -> error.detail
        is CoreException.ContextChanged -> "Your company changed. Please try again."
        else -> "Couldn’t connect. Please try again."
    }

/**
 * Replace the returned post across already-loaded feed/profile pages without a full feed reload.
 */
internal enum class SocialPostChange {
    Reactions,
    Comments,
}

internal fun mergeSocialPost(
    current: JSONObject,
    updated: JSONObject,
    change: SocialPostChange,
): JSONObject {
    val fields =
        if (change == SocialPostChange.Reactions)
            listOf("reactions", "reaction_count", "liked", "like_count")
        else listOf("comment_count")
    return JSONObject(current.toString()).apply {
        fields.forEach { field -> if (updated.has(field)) put(field, updated.get(field)) }
    }
}

internal fun applySocialPost(
    model: CommunityModel,
    updated: JSONObject,
    change: SocialPostChange,
    companyId: String?,
) {
    if (model.company?.text("id") != companyId) return
    if (updated.text("id").isBlank()) return
    model.pages.toMap().forEach { (path, page) ->
        val posts = page.optJSONArray("posts")?.objects() ?: return@forEach
        if (posts.any { it.text("id") == updated.text("id") }) {
            model.pages[path] =
                JSONObject(page.toString())
                    .put(
                        "posts",
                        JSONArray(
                            posts.map {
                                if (it.text("id") == updated.text("id"))
                                    mergeSocialPost(it, updated, change)
                                else it
                            }
                        ),
                    )
        }
    }
}

@Composable
internal fun PostSocialActions(
    model: CommunityModel,
    post: JSONObject,
    comments: () -> Unit,
    signIn: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var choosing by rememberSaveable(post.text("id")) { mutableStateOf(false) }
    var showingActors by rememberSaveable(post.text("id")) { mutableStateOf(false) }
    var pending by remember(post.text("id")) { mutableStateOf(false) }
    var error by remember(post.text("id")) { mutableStateOf<String?>(null) }
    val reactions = post.optJSONArray("reactions").objects()
    val canReact = model.company != null && !model.individual
    fun react(emoji: String) {
        if (!model.signedIn) {
            signIn()
            return
        }
        if (!canReact || pending) return
        choosing = false
        pending = true
        error = null
        val reacted =
            reactions.firstOrNull { it.text("emoji") == emoji }?.optBoolean("reacted") == true
        val companyId = model.company?.text("id")
        scope.launch {
            try {
                val updated =
                    model.jsonRequest(
                        "POST",
                        "/posts/${post.text("id")}/reactions",
                        JSONObject().put("emoji", emoji).put("reacted", !reacted),
                    )
                applySocialPost(model, updated, SocialPostChange.Reactions, companyId)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = socialError(e)
            } finally {
                pending = false
            }
        }
    }
    Column(
        Modifier.fillMaxWidth()
            .padding(horizontal = 12.dp)
            .testTag("post-actions-${post.text("id")}")
    ) {
        if (reactions.isNotEmpty()) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                items(reactions, key = { it.text("emoji") }) { reaction ->
                    val emoji = reaction.text("emoji")
                    val selected = reaction.optBoolean("reacted")
                    Box(
                        Modifier.heightIn(min = 48.dp)
                            .widthIn(min = 48.dp)
                            .clickable(
                                enabled = !pending && (!model.signedIn || canReact),
                                role = Role.Checkbox,
                            ) {
                                react(emoji)
                            }
                            .semantics {
                                this.selected = selected
                                contentDescription =
                                    "$emoji, ${reaction.optInt("count")} reactions${if (selected) ", including your company" else ""}"
                            }
                            .testTag("reaction-$emoji"),
                        contentAlignment = Alignment.Center,
                    ) {
                        Surface(
                            shape = ConnectPillShape,
                            color = if (selected) Pale else Color(0xFFF7F9FB),
                            border =
                                BorderStroke(
                                    1.dp,
                                    if (selected) Muted.copy(alpha = .55f)
                                    else Ink.copy(alpha = .08f),
                                ),
                        ) {
                            Row(
                                Modifier.padding(horizontal = 9.dp, vertical = 5.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(5.dp),
                            ) {
                                Text(emoji, fontSize = 14.sp)
                                Text(
                                    reaction.optInt("count").toString(),
                                    color = Ink,
                                    style = MaterialTheme.typography.labelSmall,
                                )
                            }
                        }
                    }
                }
            }
            TextButton(
                onClick = { showingActors = true },
                modifier = Modifier.testTag("who-reacted"),
            ) {
                Text("${post.optInt("reaction_count")} reactions", color = Muted)
                Icon(Icons.Outlined.ChevronRight, null, Modifier.size(16.dp), tint = Muted)
            }
        }
        if (error != null)
            Text(
                error!!,
                Modifier.padding(vertical = 4.dp),
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
            )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            TextButton(
                enabled = !pending && (!model.signedIn || canReact),
                onClick = { if (!model.signedIn) signIn() else choosing = true },
                modifier = Modifier.testTag("react-${post.text("id")}"),
            ) {
                Icon(Icons.Outlined.AddReaction, null, Modifier.size(20.dp))
                Spacer(Modifier.width(6.dp))
                Text(if (pending) "Reacting…" else "React")
            }
            TextButton(
                onClick = comments,
                modifier = Modifier.testTag("comments-${post.text("id")}"),
            ) {
                Icon(Icons.Outlined.ChatBubbleOutline, null, Modifier.size(20.dp))
                Spacer(Modifier.width(6.dp))
                Text("${post.optInt("comment_count")} Comments")
            }
        }
    }
    if (choosing) EmojiPicker(onClose = { choosing = false }, choose = ::react)
    if (showingActors) ReactionActorsSheet(model, post, { showingActors = false })
}

internal data class ReactionEmoji(
    val value: String,
    val name: String,
    val search: String,
    val category: String,
)

internal object ReactionEmojiCatalog {
    @Volatile private var cached: List<ReactionEmoji>? = null

    suspend fun load(context: android.content.Context): List<ReactionEmoji> =
        cached
            ?: withContext(Dispatchers.IO) {
                val rows =
                    JSONArray(
                            context.assets.open("reaction-emojis.json").bufferedReader().use {
                                it.readText()
                            }
                        )
                        .objects()
                rows
                    .map {
                        ReactionEmoji(
                            it.getString("emoji"),
                            it.getString("name"),
                            it.getString("search"),
                            it.getString("category"),
                        )
                    }
                    .also { cached = it }
            }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun EmojiPicker(onClose: () -> Unit, choose: (String) -> Unit) {
    val context = LocalContext.current
    var search by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf("All") }
    val catalog by
        produceState<List<ReactionEmoji>>(emptyList()) {
            value = ReactionEmojiCatalog.load(context)
        }
    val terms = search.trim().lowercase().split(Regex("\\s+")).filter { it.isNotBlank() }
    val visible =
        remember(catalog, category, search) {
            catalog.filter {
                (category == "All" || it.category == category) &&
                    terms.all { term -> term in it.search || term in it.value }
            }
        }
    ModalBottomSheet(
        onDismissRequest = onClose,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Color.White,
        modifier = Modifier.testTag("emoji-picker"),
    ) {
        Column(
            Modifier.fillMaxWidth().heightIn(max = 620.dp).imePadding().padding(horizontal = 16.dp)
        ) {
            SheetHeading("Choose a reaction", onClose)
            OutlinedTextField(
                search,
                { search = it },
                singleLine = true,
                placeholder = { Text("Search all emojis…") },
                leadingIcon = { Icon(Icons.Outlined.Search, null) },
                modifier = Modifier.fillMaxWidth().testTag("emoji-search"),
            )
            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.padding(vertical = 8.dp),
            ) {
                items(listOf("All") + catalog.map { it.category }.distinct()) { item ->
                    ConnectFilterChip(category == item, { category = item }, { Text(item) })
                }
            }
            if (catalog.isEmpty())
                Box(Modifier.fillMaxWidth().height(120.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            else if (visible.isEmpty())
                Text(
                    "No matching emojis. Try another word.",
                    Modifier.padding(24.dp),
                    color = Muted,
                )
            else
                LazyVerticalGrid(
                    GridCells.Adaptive(52.dp),
                    modifier = Modifier.weight(1f, fill = false).heightIn(min = 180.dp),
                    contentPadding = PaddingValues(bottom = 20.dp),
                ) {
                    items(visible, key = { it.value }) { emoji ->
                        TextButton(
                            onClick = { choose(emoji.value) },
                            contentPadding = PaddingValues(4.dp),
                            modifier =
                                Modifier.sizeIn(minWidth = 48.dp, minHeight = 52.dp)
                                    .semantics { contentDescription = emoji.name }
                                    .testTag("emoji-${emoji.value}"),
                        ) {
                            Text(emoji.value, fontSize = 28.sp)
                        }
                    }
                }
        }
    }
}

@Composable
internal fun SheetHeading(title: String, close: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
            title,
            Modifier.weight(1f),
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.SemiBold,
        )
        IconButton(onClick = close) { Icon(Icons.Outlined.Close, "Close") }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReactionActorsSheet(model: CommunityModel, post: JSONObject, close: () -> Unit) {
    var selected by rememberSaveable { mutableStateOf("") }
    val currentSelection by rememberUpdatedState(selected)
    var actors by remember(selected) { mutableStateOf(emptyList<JSONObject>()) }
    var next by remember(selected) { mutableStateOf<String?>(null) }
    var loading by remember(selected) { mutableStateOf(false) }
    var error by remember(selected) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    suspend fun load(after: String? = null) {
        val filter = selected
        loading = true
        error = null
        try {
            val response =
                model.fetchJson(
                    "/posts/${post.text("id")}/reactions?emoji=${query(filter)}${after?.let { "&after=${query(it)}" }.orEmpty()}"
                )
            if (currentSelection != filter) return
            actors =
                (if (after == null) emptyList() else actors) +
                    response.optJSONArray("reactions").objects()
            actors = actors.distinctBy { it.text("id") }
            next = response.text("nextCursor").takeIf { it.isNotBlank() && it != "null" }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (currentSelection == filter) error = socialError(e)
        } finally {
            loading = false
        }
    }
    LaunchedEffect(selected) { load() }
    ModalBottomSheet(
        onDismissRequest = close,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Color.White,
        modifier = Modifier.testTag("reaction-actors"),
    ) {
        Column(Modifier.fillMaxWidth().heightIn(max = 650.dp).padding(horizontal = 16.dp)) {
            SheetHeading("Who reacted", close)
            LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                item {
                    ConnectFilterChip(
                        selected.isEmpty(),
                        { selected = "" },
                        { Text("All ${post.optInt("reaction_count")}") },
                    )
                }
                items(post.optJSONArray("reactions").objects(), key = { it.text("emoji") }) {
                    reaction ->
                    ConnectFilterChip(
                        selected == reaction.text("emoji"),
                        { selected = reaction.text("emoji") },
                        { Text("${reaction.text("emoji")} ${reaction.optInt("count")}") },
                    )
                }
            }
            LazyColumn(
                Modifier.fillMaxWidth().weight(1f, fill = false).heightIn(min = 180.dp),
                contentPadding = PaddingValues(vertical = 12.dp),
            ) {
                items(actors, key = { it.text("id") }) { actor ->
                    val company = actor.optJSONObject("company") ?: JSONObject()
                    Row(
                        Modifier.fillMaxWidth()
                            .clickable {
                                close()
                                model.profile(company.text("id"))
                            }
                            .padding(vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        CompanyAvatar(company, 42)
                        Column(Modifier.weight(1f)) {
                            Text(company.text("name"), fontWeight = FontWeight.SemiBold)
                            actor
                                .optJSONObject("user")
                                ?.text("name")
                                ?.takeIf { it.isNotBlank() }
                                ?.let {
                                    Text(
                                        it,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = Muted,
                                    )
                                }
                        }
                        Text(actor.text("emoji"), fontSize = 26.sp)
                    }
                }
                if (!loading && actors.isEmpty() && error == null)
                    item { Text("No reactions yet.", Modifier.padding(20.dp), color = Muted) }
                if (error != null)
                    item {
                        Text(error!!, color = MaterialTheme.colorScheme.error)
                        TextButton(onClick = { scope.launch { load(next) } }) { Text("Try again") }
                    }
                if (loading)
                    item {
                        Box(
                            Modifier.fillMaxWidth().padding(20.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            CircularProgressIndicator(Modifier.size(24.dp))
                        }
                    }
                if (!loading && next != null)
                    item {
                        TextButton(
                            onClick = { scope.launch { load(next) } },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Show more")
                        }
                    }
            }
        }
    }
}
