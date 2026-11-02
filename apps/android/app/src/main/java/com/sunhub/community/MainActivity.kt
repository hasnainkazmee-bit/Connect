package com.sunhub.community

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import coil3.compose.AsyncImage
import com.sunhub.core.UploadFile
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

internal val Ink = Color(0xFF192936)
internal val Navy = Color(0xFF153E67)
internal val Orange = Color(0xFFFF6B0B)
internal val Pale = Color(0xFFF2F7FC)
internal val Muted = Color(0xFF62748A)

class MainActivity : ComponentActivity() {
    private val communityModel: CommunityModel by viewModels()

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        communityModel.handleSunhubCallback(intent.data)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        communityModel.handleSunhubCallback(intent?.data)
        setContent {
            MaterialTheme(
                shapes = ConnectShapes,
                colorScheme =
                    lightColorScheme(
                        primary = Ink,
                        onPrimary = Color.White,
                        primaryContainer = Pale,
                        secondary = Ink,
                        secondaryContainer = Pale,
                        onSecondaryContainer = Ink,
                        background = Pale,
                        surface = Color.White,
                        onSurface = Ink,
                        surfaceVariant = Pale,
                        onSurfaceVariant = Muted,
                    ),
            ) {
                ConnectApp(communityModel)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConnectApp(model: CommunityModel = viewModel()) {
    val updates: AppUpdates = viewModel()
    var updateInfo by rememberSaveable { mutableStateOf(false) }
    if (updateInfo) UpdateDialog(updates) { updateInfo = false }
    var auth by rememberSaveable { mutableStateOf(false) }
    var security by rememberSaveable { mutableStateOf(false) }
    var setupCompany by rememberSaveable { mutableStateOf(false) }
    var createPost by rememberSaveable { mutableStateOf(false) }
    var companyDrafts by rememberSaveable { mutableStateOf(false) }
    var pendingCreate by rememberSaveable { mutableStateOf(false) }
    var publishingNotice by rememberSaveable { mutableStateOf("") }
    fun requestCreate() {
        if (model.booting) return
        when {
            !model.signedIn -> {
                pendingCreate = true
                auth = true
            }
            model.individual -> {
                pendingCreate = false
                publishingNotice =
                    "Posts and press releases come from company profiles. You can follow companies, leave a customer review, and start a conversation with this account."
            }
            model.company == null -> {
                pendingCreate = true
                setupCompany = true
            }
            !model.admin -> {
                pendingCreate = false
                publishingNotice =
                    "A company owner or administrator can publish updates. Ask an administrator at your company to update your access."
            }
            else -> {
                pendingCreate = false
                createPost = true
            }
        }
    }
    LaunchedEffect(
        model.booting,
        model.signedIn,
        model.needsOnboarding,
        setupCompany,
        pendingCreate,
    ) {
        if (
            !model.booting &&
                pendingCreate &&
                model.signedIn &&
                !model.needsOnboarding &&
                !setupCompany
        )
            requestCreate()
    }
    LaunchedEffect(model.booting, model.signedIn, model.company?.text("id"), model.admin) {
        if (!model.booting && (!model.signedIn || !model.admin)) createPost = false
    }
    val welcomePrefs =
        LocalContext.current.getSharedPreferences(
            "connect-intro",
            android.content.Context.MODE_PRIVATE,
        )
    var welcome by rememberSaveable { mutableStateOf(!welcomePrefs.getBoolean("seen", false)) }
    var initialAuthMode by rememberSaveable { mutableStateOf("login") }
    fun finishWelcome() {
        welcome = false
        welcomePrefs.edit().putBoolean("seen", true).apply()
    }
    LaunchedEffect(model.sunhubReturnReady) {
        if (model.sunhubReturnReady) {
            finishWelcome()
            if (!model.signedIn) {
                initialAuthMode = "login"
                auth = true
            }
            model.acknowledgeSunhubReturn()
        }
    }
    var afterSignIn by remember { mutableStateOf<(() -> Unit)?>(null) }
    var account by remember { mutableStateOf(false) }
    var personalThread by
        remember(model.session?.optJSONObject("user")?.text("id"), model.company?.text("id")) {
            mutableStateOf<JSONObject?>(null)
        }
    var peopleInbox by rememberSaveable { mutableStateOf(false) }
    var employeeAccess by remember { mutableStateOf(false) }
    if (employeeAccess && model.admin) EmployeeAccess(model) { employeeAccess = false }
    val screenStates = rememberSaveableStateHolder()
    val tabs =
        remember(model.individual) { Tab.entries.filter { !model.individual || it != Tab.Network } }
    val pager =
        key(tabs) {
            // An account change can remove Network. Replace the state and lazy provider
            // together so neither observes an old page count with a new destination list.
            rememberPagerState(
                initialPage = tabs.indexOf(model.tab).coerceAtLeast(0),
                pageCount = { tabs.size },
            )
        }
    LaunchedEffect(model.tab, tabs) {
        val index = tabs.indexOf(model.tab)
        if (index >= 0 && pager.currentPage != index) pager.animateScrollToPage(index)
    }
    LaunchedEffect(pager.settledPage, tabs) {
        val target = tabs[pager.settledPage.coerceIn(tabs.indices)]
        if (!pager.isScrollInProgress && target != model.tab) {
            if (!model.signedIn && target in listOf(Tab.Network, Tab.Messages)) {
                afterSignIn = { model.selectTab(target) }
                auth = true
            } else model.selectTab(target)
        }
    }
    val homeScroll = rememberLazyListState()
    var publishedPostId by remember(model.company?.text("id")) { mutableStateOf<String?>(null) }
    fun refreshPublishedFeed(post: JSONObject) {
        publishedPostId = post.text("id")
        model.refreshCompany()
    }
    val directoryScroll = rememberLazyListState()
    val networkScroll = rememberLazyListState()
    val messagesScroll = rememberLazyListState()
    val lifecycle = LocalLifecycleOwner.current
    DisposableEffect(lifecycle, model) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_START) {
                model.observe(true)
                updates.check()
            }
            if (event == Lifecycle.Event.ON_STOP) model.observe(false)
        }
        lifecycle.lifecycle.addObserver(observer)
        model.observe(lifecycle.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))
        updates.check()
        onDispose {
            lifecycle.lifecycle.removeObserver(observer)
            model.observe(false)
        }
    }
    if (!model.booting && (model.needsOnboarding || setupCompany)) {
        OnboardingScreen(
            model,
            onSignOut = {
                model.logout()
                auth = false
                setupCompany = false
                pendingCreate = false
            },
            onComplete = {
                setupCompany = false
                auth = false
                initialAuthMode = "login"
                afterSignIn?.invoke()
                afterSignIn = null
            },
        )
        return
    }
    if (auth) {
        AuthScreen(
            model,
            initialAuthMode,
            onClose = {
                model.cancelSunhubSignIn()
                auth = false
                pendingCreate = false
                afterSignIn = null
                initialAuthMode = "login"
                model.dismissError()
            },
            onSignedIn = {
                auth = false
                initialAuthMode = "login"
                if (!model.needsOnboarding) {
                    afterSignIn?.invoke()
                    afterSignIn = null
                }
            },
        )
        return
    }
    if (!model.booting && !model.signedIn && welcome) {
        WelcomeScreen(
            onCreate = {
                finishWelcome()
                initialAuthMode = "register"
                auth = true
            },
            onSignIn = {
                finishWelcome()
                initialAuthMode = "login"
                auth = true
            },
            onBrowse = { finishWelcome() },
        )
        return
    }
    if (security && model.signedIn) {
        SecurityScreen(model) { security = false }
        return
    }
    val detail = model.profileId != null || model.chatCompany != null || personalThread != null
    val goBack = { if (personalThread != null) personalThread = null else model.back() }
    BackHandler(detail) { goBack() }
    if (publishingNotice.isNotBlank()) {
        AlertDialog(
            onDismissRequest = { publishingNotice = "" },
            title = { Text("Publishing with your company") },
            text = { Text(publishingNotice) },
            confirmButton = { TextButton(onClick = { publishingNotice = "" }) { Text("Got it") } },
        )
    }
    if (companyDrafts && model.admin)
        PublicationDrafts(model, ::refreshPublishedFeed) { companyDrafts = false }
    if (createPost && model.admin) {
        PublicationComposer(model, null, { createPost = false }, ::refreshPublishedFeed)
    }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wideNavigation = maxWidth >= 840.dp
        val keyboardVisible = WindowInsets.ime.getBottom(LocalDensity.current) > 0
        fun select(tab: Tab) {
            if (!model.signedIn && tab in listOf(Tab.Network, Tab.Messages)) {
                afterSignIn = { model.selectTab(tab) }
                auth = true
            } else {
                if (tab == Tab.Home && model.tab == Tab.Home) model.load("/feed?scope=all", true)
                model.selectTab(tab)
            }
        }
        Scaffold(
            containerColor = Pale,
            topBar = {
                TopAppBar(
                    title = {
                        if (detail)
                            Text(
                                if (model.profileId != null) "Company"
                                else
                                    personalThread?.text("person_name")
                                        ?: model.chatCompany?.optString("name").orEmpty(),
                                style = MaterialTheme.typography.titleMedium,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        else
                            Image(
                                painterResource(R.drawable.connect_logo),
                                "Connect",
                                Modifier.width(160.dp).height(32.dp),
                                contentScale = ContentScale.Fit,
                            )
                    },
                    navigationIcon = {
                        if (detail)
                            IconButton(onClick = goBack) {
                                Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back")
                            }
                    },
                    actions = {
                        if (model.signedIn)
                            Box {
                                IconButton(onClick = { account = true }) {
                                    Icon(Icons.Outlined.AccountCircle, "Account and company")
                                }
                                DropdownMenu(account, onDismissRequest = { account = false }) {
                                    model.companies.forEach { company ->
                                        DropdownMenuItem(
                                            text = { Text(company.optString("name")) },
                                            enabled = !model.busy,
                                            leadingIcon = {
                                                if (
                                                    company.optString("id") ==
                                                        model.company?.optString("id")
                                                )
                                                    Icon(Icons.Outlined.Check, null)
                                            },
                                            onClick = {
                                                account = false
                                                model.switchCompany(company.optString("id"))
                                            },
                                        )
                                    }
                                    if (model.company == null && !model.individual)
                                        DropdownMenuItem(
                                            text = { Text("Set up company") },
                                            onClick = {
                                                account = false
                                                setupCompany = true
                                            },
                                        )
                                    if (model.company != null)
                                        DropdownMenuItem(
                                            text = { Text("Company profile") },
                                            onClick = {
                                                account = false
                                                model.profile(model.company!!.text("id"))
                                            },
                                        )
                                    if (model.admin)
                                        DropdownMenuItem(
                                            text = { Text("Drafts") },
                                            onClick = {
                                                account = false
                                                companyDrafts = true
                                            },
                                        )
                                    if (model.admin)
                                        DropdownMenuItem(
                                            text = { Text("Employee access") },
                                            onClick = {
                                                account = false
                                                employeeAccess = true
                                            },
                                        )
                                    DropdownMenuItem(
                                        text = { Text("App updates") },
                                        onClick = {
                                            account = false
                                            updateInfo = true
                                            updates.check(true)
                                        },
                                    )
                                    DropdownMenuItem(
                                        text = { Text("Account & security") },
                                        onClick = {
                                            account = false
                                            security = true
                                        },
                                    )
                                    DropdownMenuItem(
                                        enabled = !model.busy,
                                        text = { Text("Sign out") },
                                        onClick = {
                                            account = false
                                            model.logout()
                                        },
                                    )
                                }
                            }
                        else
                            ConnectButton(
                                onClick = { auth = true },
                                modifier = Modifier.padding(end = 12.dp),
                            ) {
                                Text("Sign in")
                            }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = Pale),
                )
            },
            bottomBar = {
                if (!detail && !wideNavigation && !keyboardVisible)
                    FloatingConnectNavigation(
                        tabs,
                        model.tab,
                        model.incoming.size,
                        ::select,
                        ::requestCreate,
                    )
            },
        ) { padding ->
            Row(Modifier.fillMaxSize().padding(padding).imePadding()) {
                if (wideNavigation && !detail)
                    NavigationRail(
                        containerColor = Pale,
                        modifier = Modifier.fillMaxHeight().width(96.dp).testTag("navigation-rail"),
                    ) {
                        Spacer(Modifier.height(12.dp))
                        CreatePostButton(::requestCreate)
                        Spacer(Modifier.height(20.dp))
                        tabs.forEach { tab ->
                            NavigationRailItem(
                                selected = tab == model.tab,
                                onClick = { select(tab) },
                                icon = {
                                    Icon(
                                        when (tab) {
                                            Tab.Home -> Icons.Outlined.Home
                                            Tab.Companies -> Icons.Outlined.Business
                                            Tab.Network -> Icons.Outlined.People
                                            Tab.Messages -> Icons.AutoMirrored.Outlined.Chat
                                        },
                                        null,
                                    )
                                },
                                label = { Text(tab.name) },
                                colors =
                                    NavigationRailItemDefaults.colors(
                                        selectedIconColor = Ink,
                                        selectedTextColor = Ink,
                                        indicatorColor = Orange,
                                    ),
                            )
                            Spacer(Modifier.height(12.dp))
                        }
                    }
                Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.TopCenter) {
                    Column(
                        Modifier.widthIn(
                                max =
                                    if (model.tab == Tab.Messages || detail) WorkspaceWidthDp.dp
                                    else FeedWidthDp.dp
                            )
                            .fillMaxSize()
                            .testTag("content-lane")
                    ) {
                        UpdateBanner(updates) { updateInfo = true }
                        model.error?.let { error ->
                            Surface(color = MaterialTheme.colorScheme.errorContainer) {
                                Row(
                                    Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(
                                        error,
                                        Modifier.weight(1f),
                                        style = MaterialTheme.typography.bodySmall,
                                    )
                                    IconButton(onClick = model::dismissError) {
                                        Icon(Icons.Outlined.Close, "Dismiss error")
                                    }
                                }
                            }
                        }
                        if (model.offline)
                            Row(
                                Modifier.fillMaxWidth()
                                    .background(Color(0xFFFFF3D7))
                                    .padding(start = 16.dp, end = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    if (model.pages.isEmpty()) "Can’t connect right now"
                                    else "Offline · showing saved content",
                                    Modifier.weight(1f),
                                    style = MaterialTheme.typography.labelMedium,
                                )
                                TextButton(onClick = model::retryConnection) { Text("Retry") }
                            }
                        if (model.booting) LoadingScreen()
                        else if (detail) {
                            val screenKey =
                                "detail:${model.session?.optJSONObject("user")?.text("id")}:${model.company?.text("id")}:${personalThread?.text("id")?:model.profileId?:model.chatCompany?.text("id")}"
                            screenStates.SaveableStateProvider(screenKey) {
                                when {
                                    personalThread != null ->
                                        PersonalChat(model, threadId = personalThread!!.text("id"))
                                    model.profileId != null ->
                                        CompanyProfileScreen(
                                            model,
                                            model.profileId!!,
                                            onSignIn = { auth = true },
                                            onMessageSignIn = { company ->
                                                afterSignIn = { model.chat(company) }
                                                auth = true
                                            },
                                        )
                                    model.chatCompany != null ->
                                        if (model.individual)
                                            PersonalChat(model, company = model.chatCompany)
                                        else ChatScreen(model)
                                }
                            }
                        } else
                            key(tabs) {
                                HorizontalPager(
                                    state = pager,
                                    modifier = Modifier.weight(1f).testTag("main-tabs"),
                                    verticalAlignment = Alignment.Top,
                                    key = { tabs[it].name },
                                ) { page ->
                                    val tab = tabs[page]
                                    screenStates.SaveableStateProvider(
                                        "tab:${model.session?.optJSONObject("user")?.text("id")}:${model.company?.text("id")}:${tab.name}"
                                    ) {
                                        if (
                                            !model.signedIn &&
                                                tab in listOf(Tab.Network, Tab.Messages)
                                        )
                                            Box(
                                                Modifier.fillMaxSize(),
                                                contentAlignment = Alignment.Center,
                                            ) {
                                                ConnectButton(
                                                    onClick = {
                                                        afterSignIn = { model.selectTab(tab) }
                                                        auth = true
                                                    }
                                                ) {
                                                    Text("Sign in to ${tab.name.lowercase()}")
                                                }
                                            }
                                        else
                                            when (tab) {
                                                Tab.Home ->
                                                    FeedScreen(
                                                        model,
                                                        homeScroll,
                                                        publishedPostId,
                                                        onPublishedVisible = {
                                                            publishedPostId = null
                                                        },
                                                        onSignIn = { auth = true },
                                                    )
                                                Tab.Companies ->
                                                    DirectoryScreen(model, directoryScroll)
                                                Tab.Network -> NetworkScreen(model, networkScroll)
                                                Tab.Messages ->
                                                    if (model.individual)
                                                        PersonalInbox(model) { personalThread = it }
                                                    else
                                                        Column {
                                                            Row(
                                                                Modifier.padding(
                                                                    horizontal = 16.dp
                                                                ),
                                                                horizontalArrangement =
                                                                    Arrangement.spacedBy(8.dp),
                                                            ) {
                                                                ConnectFilterChip(
                                                                    !peopleInbox,
                                                                    { peopleInbox = false },
                                                                    label = { Text("Companies") },
                                                                )
                                                                ConnectFilterChip(
                                                                    peopleInbox,
                                                                    { peopleInbox = true },
                                                                    label = { Text("People") },
                                                                )
                                                            }
                                                            if (peopleInbox)
                                                                PersonalInbox(model) {
                                                                    personalThread = it
                                                                }
                                                            else
                                                                MessagesScreen(
                                                                    model,
                                                                    messagesScroll,
                                                                )
                                                        }
                                            }
                                    }
                                }
                            }
                    }
                }
            }
        }
    }
}

@Composable
private fun LoadingScreen() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(Modifier.size(28.dp))
    }
}

@Composable
internal fun CompanyAvatar(company: JSONObject, size: Int = 42) {
    val letters =
        company
            .optString("name")
            .split(" ")
            .take(2)
            .mapNotNull { it.firstOrNull() }
            .joinToString("")
    Box(
        Modifier.size(size.dp).clip(RoundedCornerShape(12.dp)).background(Navy.copy(alpha = .09f)),
        contentAlignment = Alignment.Center,
    ) {
        if (company.text("logo_url").isNotBlank())
            AsyncImage(
                if (company.text("logo_url").startsWith("/"))
                    BuildConfig.API_URL.trimEnd('/') + company.text("logo_url")
                else company.text("logo_url"),
                null,
                Modifier.fillMaxSize(),
                contentScale = ContentScale.Fit,
            )
        else
            Text(
                letters,
                color = Navy,
                fontWeight = FontWeight.SemiBold,
                style = MaterialTheme.typography.labelLarge,
            )
    }
}

@Composable
private fun CompanyRow(company: JSONObject, subtitle: String = "", onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth()
            .testTag("company-${company.optString("id")}")
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 15.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        CompanyAvatar(company)
        Column(Modifier.weight(1f)) {
            Text(
                company.optString("name"),
                style = MaterialTheme.typography.titleSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                subtitle.ifBlank {
                    listOf(company.optString("type"), company.optString("location"))
                        .filter { it.isNotBlank() }
                        .joinToString(" · ")
                },
                style = MaterialTheme.typography.bodySmall,
                color = Muted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Icon(Icons.Outlined.ChevronRight, null, tint = Muted, modifier = Modifier.size(18.dp))
    }
}

@Composable
private fun SearchField(value: String, onChange: (String) -> Unit) {
    OutlinedTextField(
        value,
        onValueChange = onChange,
        modifier = Modifier.fillMaxWidth().padding(16.dp),
        singleLine = true,
        placeholder = { Text("Search companies…") },
        leadingIcon = { Icon(Icons.Outlined.Search, null) },
        shape = ConnectPillShape,
    )
}

@Composable
private fun Pagination(page: Int, total: Int, pageSize: Int = 24, change: (Int) -> Unit) {
    if (total > pageSize)
        Row(
            Modifier.fillMaxWidth().padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = { change(page - 1) }, enabled = page > 1) { Text("Previous") }
            Text(
                "$page of ${(total + pageSize - 1) / pageSize}",
                style = MaterialTheme.typography.bodySmall,
            )
            TextButton(onClick = { change(page + 1) }, enabled = page * pageSize < total) {
                Text("Next")
            }
        }
}

@Composable
private fun DirectoryScreen(model: CommunityModel, scroll: LazyListState) {
    var search by rememberSaveable { mutableStateOf("") }
    var page by rememberSaveable { mutableIntStateOf(1) }
    val path = "/companies?q=${query(search)}&page=$page"
    LaunchedEffect(path) {
        kotlinx.coroutines.delay(180)
        model.load(path)
    }
    Column {
        SearchField(search) {
            search = it
            page = 1
        }
        val result = model.pages[path]
        if (result == null) LoadingScreen()
        else
            LazyColumn(state = scroll, modifier = Modifier.weight(1f)) {
                item {
                    Text(
                        "${result.optInt("total")} companies",
                        Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                        style = MaterialTheme.typography.labelMedium,
                        color = Muted,
                    )
                }
                items(result.optJSONArray("companies").objects(), key = { it.optString("id") }) {
                    company ->
                    CompanyRow(company) { model.profile(company.optString("id")) }
                }
                item { Pagination(page, result.optInt("total")) { page = it } }
            }
    }
}

@Composable
private fun NetworkScreen(model: CommunityModel, scroll: LazyListState) {
    var type by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(Unit) { model.load("/network") }
    val connections =
        model.connections.filter {
            it.optString("status") == "connected" && !it.optBoolean("blocked")
        }
    val types =
        listOf(
            "Installer" to "Installers",
            "EPC" to "EPCs",
            "Developer" to "Developers",
            "Distributor" to "Distributors",
            "Manufacturer" to "Manufacturers",
            "Service provider" to "Services",
        )
    LazyColumn(state = scroll, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        item {
            Column(Modifier.padding(16.dp)) {
                Text("My Network", style = MaterialTheme.typography.headlineSmall)
                Text(
                    "${connections.size} connections",
                    style = MaterialTheme.typography.bodySmall,
                    color = Muted,
                )
            }
        }
        item {
            androidx.compose.foundation.lazy.LazyRow(
                contentPadding = PaddingValues(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                item {
                    ConnectFilterChip(
                        type.isEmpty(),
                        onClick = { type = "" },
                        label = { Text("All ${connections.size}") },
                    )
                }
                items(types) { pair ->
                    ConnectFilterChip(
                        type == pair.first,
                        onClick = { type = pair.first },
                        label = {
                            Text(
                                "${pair.second} ${connections.count { it.optJSONObject("company")?.optString("type") == pair.first }}"
                            )
                        },
                    )
                }
            }
        }
        types
            .filter { type.isEmpty() || type == it.first }
            .forEach { pair ->
                val group =
                    connections.filter {
                        it.optJSONObject("company")?.optString("type") == pair.first
                    }
                if (group.isNotEmpty()) {
                    item(key = pair.first) {
                        Text(
                            "${pair.second}  ${group.size}",
                            Modifier.padding(16.dp),
                            style = MaterialTheme.typography.titleSmall,
                        )
                    }
                    items(group, key = { it.optString("id") }) { connection ->
                        CompanyRow(connection.getJSONObject("company")) {
                            model.chat(connection.getJSONObject("company"))
                        }
                    }
                }
            }
        if (
            connections.none {
                type.isEmpty() || it.optJSONObject("company")?.optString("type") == type
            }
        )
            item {
                Text(
                    "No connections yet. Accepted requests appear here.",
                    Modifier.padding(24.dp),
                    color = Muted,
                )
            }
    }
}

@Composable
private fun MessagesScreen(model: CommunityModel, scroll: LazyListState) {
    var search by rememberSaveable { mutableStateOf("") }
    var page by rememberSaveable { mutableIntStateOf(1) }
    var filter by rememberSaveable { mutableIntStateOf(0) }
    val path = "/messaging/companies?q=${query(search)}&page=$page"
    LaunchedEffect(path, filter) {
        model.load("/network")
        if (filter == 0) {
            kotlinx.coroutines.delay(180)
            model.load(path)
        }
    }
    Column {
        SearchField(search) {
            search = it
            page = 1
        }
        TabRow(selectedTabIndex = filter) {
            listOf(
                    "All companies",
                    "Chats",
                    "Requests${if (model.incoming.isNotEmpty()) " ${model.incoming.size}" else ""}",
                )
                .forEachIndexed { index, label ->
                    androidx.compose.material3.Tab(
                        filter == index,
                        onClick = { filter = index },
                        text = { Text(label, style = MaterialTheme.typography.labelMedium) },
                    )
                }
        }
        val companies =
            (when (filter) {
                    0 -> model.pages[path]?.optJSONArray("companies").objects()
                    1 -> model.connections.map { it.getJSONObject("company") }
                    else -> (model.incoming + model.sent).map { it.getJSONObject("company") }
                })
                .filter { filter == 0 || it.optString("name").contains(search, true) }
                .distinctBy { it.optString("id") }
        LazyColumn(state = scroll, modifier = Modifier.weight(1f)) {
            items(companies, key = { it.optString("id") }) { company ->
                val pending =
                    (model.incoming + model.sent).firstOrNull {
                        it.getJSONObject("company").optString("id") == company.optString("id")
                    }
                val connection =
                    model.connections.firstOrNull {
                        it.getJSONObject("company").optString("id") == company.optString("id")
                    }
                val subtitle =
                    pending?.let {
                        (if (it.optString("to_id") == model.company?.optString("id")) "Request: "
                        else "Sent request: ") + it.optString("note", "Let’s connect.")
                    }
                        ?: connection
                            ?.optString("last_message")
                            .orEmpty()
                            .takeUnless { it == "null" }
                            .orEmpty()
                InboxRow(
                    company,
                    subtitle,
                    connection?.optString("last_message_at").orEmpty(),
                    connection?.optInt("unread") ?: 0,
                    pending != null,
                ) {
                    model.chat(company)
                }
            }
            if (companies.isEmpty())
                item {
                    Text(
                        if (filter == 2) "No pending requests."
                        else "Search for a company to start a conversation.",
                        Modifier.padding(24.dp),
                        color = Muted,
                    )
                }
            if (filter == 0)
                item { Pagination(page, model.pages[path]?.optInt("total") ?: 0) { page = it } }
        }
    }
}

@Composable
private fun FeedScreen(
    model: CommunityModel,
    scroll: LazyListState,
    publishedPostId: String?,
    onPublishedVisible: () -> Unit,
    onSignIn: () -> Unit,
) {
    val commentIdentity =
        "${model.session?.optJSONObject("user")?.text("id")}:${model.company?.text("id")}"
    var commentPost by remember(commentIdentity) { mutableStateOf<String?>(null) }
    var commentDrafts by rememberSaveable(commentIdentity) { mutableStateOf("{}") }
    var readPost by remember { mutableStateOf<JSONObject?>(null) }
    val firstPath = "/feed?scope=all"
    var paths by rememberSaveable(firstPath) { mutableStateOf(listOf(firstPath)) }
    val path = paths.last()
    LaunchedEffect(path) { model.load(path) }
    val result = model.pages[path]
    val posts =
        paths
            .flatMap { model.pages[it]?.optJSONArray("posts").objects() }
            .distinctBy { it.optString("id") }
    val publishedIndex = posts.indexOfFirst { it.text("id") == publishedPostId }
    LaunchedEffect(publishedPostId, publishedIndex) {
        if (publishedPostId != null && publishedIndex >= 0) {
            // The new item must already belong to the composed data set before scrolling;
            // scrolling when the HTTP job ends lets stable keys re-anchor the old first card.
            scroll.scrollToItem(publishedIndex)
            onPublishedVisible()
        }
    }
    LazyColumn(
        state = scroll,
        modifier = Modifier.fillMaxSize().testTag("news-feed"),
        contentPadding = PaddingValues(bottom = 16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        items(posts, key = { it.optString("id") }) { post ->
            var expanded by rememberSaveable(post.optString("id")) { mutableStateOf(false) }
            var overflows by remember(post.optString("id")) { mutableStateOf(false) }
            Card(
                Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                shape = ConnectCardShape,
                colors = CardDefaults.cardColors(containerColor = Color.White),
            ) {
                val time =
                    runCatching {
                            android.text.format.DateUtils.getRelativeTimeSpanString(
                                    java.time.Instant.parse(post.optString("created_at"))
                                        .toEpochMilli(),
                                    System.currentTimeMillis(),
                                    android.text.format.DateUtils.MINUTE_IN_MILLIS,
                                )
                                .toString()
                        }
                        .getOrDefault("")
                CompanyRow(
                    post.getJSONObject("company"),
                    listOf(post.optString("author_name"), time)
                        .filter { it.isNotBlank() }
                        .joinToString(" · "),
                ) {
                    model.profile(post.getJSONObject("company").optString("id"))
                }
                if (post.text("kind") == "post" && post.optJSONObject("document") != null) {
                    Column(
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        PublicationBody(model, post)
                    }
                } else {
                    if (post.text("kind") != "post" && post.text("title").isNotBlank())
                        PublicationHeading(
                            post,
                            Modifier.padding(horizontal = 16.dp).clickable { readPost = post },
                            compact = true,
                        )
                    if (post.optString("body").isNotBlank())
                        Text(
                            PublicationWriting.summary(post),
                            Modifier.padding(start = 16.dp, end = 16.dp, bottom = 8.dp),
                            style = MaterialTheme.typography.bodyMedium,
                            maxLines = if (expanded) Int.MAX_VALUE else 5,
                            overflow = TextOverflow.Ellipsis,
                            onTextLayout = { if (!expanded) overflows = it.hasVisualOverflow },
                        )
                    if ((overflows || expanded) && post.text("kind") == "post")
                        TextButton(
                            onClick = { expanded = !expanded },
                            modifier = Modifier.padding(horizontal = 4.dp),
                        ) {
                            Text(if (expanded) "Show less" else "Show more")
                        }
                    PublicationMediaGallery(model, post, compactRelease = true)
                }
                if (post.text("kind") != "post")
                    TextButton(
                        onClick = { readPost = post },
                        modifier = Modifier.padding(horizontal = 4.dp),
                    ) {
                        Text(
                            if (post.text("kind") == "press_release") "Read press release"
                            else "Read company update"
                        )
                        Icon(Icons.Outlined.ArrowOutward, null, Modifier.size(18.dp))
                    }
                PostSocialActions(
                    model,
                    post,
                    comments = { commentPost = post.text("id") },
                    signIn = onSignIn,
                )
            }
        }
        if (result == null)
            item {
                Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(Modifier.size(26.dp))
                }
            }
        if (result != null && posts.isEmpty())
            item {
                Text(
                    "No posts yet. Follow companies to hear what they’re working on.",
                    Modifier.padding(24.dp),
                    color = Muted,
                )
            }
        if (result?.optString("nextCursor")?.let { it.isNotBlank() && it != "null" } == true)
            item {
                TextButton(
                    onClick = {
                        paths = paths + "$firstPath&before=${query(result.optString("nextCursor"))}"
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Older posts")
                }
            }
    }
    readPost?.let { post ->
        WorkSheet(model, publicationLabel(post.text("kind")), { readPost = null }) {
            PublicationBody(model, post)
        }
    }
    commentPost?.let { id ->
        PostCommentsSheet(
            model,
            id,
            close = { commentPost = null },
            signIn = onSignIn,
            savedDraft = JSONObject(commentDrafts).optJSONObject(id)?.toString(),
            saveDraft = { body, target ->
                commentDrafts =
                    JSONObject(commentDrafts)
                        .put(
                            id,
                            JSONObject().put("body", body).put("target", target ?: JSONObject.NULL),
                        )
                        .toString()
            },
        )
    }
}

@Composable
internal fun PostMedia(model: CommunityModel, media: JSONObject, ratio: Float = 1f) {
    val uri = mediaUrl(model, media.text("url"))
    val handler = LocalUriHandler.current
    var fullImage by rememberSaveable(uri) { mutableStateOf(false) }
    if (fullImage)
        Dialog(
            onDismissRequest = { fullImage = false },
            properties = DialogProperties(usePlatformDefaultWidth = false),
        ) {
            Box(Modifier.fillMaxSize().background(Ink)) {
                AsyncImage(
                    publicationImage(model, media.text("url")),
                    media.text("alt").ifBlank { "Full size photo" },
                    Modifier.fillMaxSize(),
                    contentScale = ContentScale.Fit,
                )
                FilledTonalIconButton(
                    onClick = { fullImage = false },
                    modifier = Modifier.align(Alignment.TopEnd).padding(16.dp),
                ) {
                    Icon(Icons.Outlined.Close, "Close photo")
                }
            }
        }
    when {
        media.optString("mime").startsWith("image/") ->
            AsyncImage(
                publicationImage(model, media.text("url")),
                media.optString("alt").ifBlank { "Post image" },
                Modifier.fillMaxWidth().aspectRatio(ratio).background(Pale).clickable {
                    fullImage = true
                },
                contentScale = ContentScale.Fit,
            )
        media.optString("mime").startsWith("video/") -> {
            var play by rememberSaveable(uri) { mutableStateOf(false) }
            if (play) NativeVideo(model, uri)
            else
                Box(
                    Modifier.fillMaxWidth().aspectRatio(16f / 9f).background(Ink),
                    contentAlignment = Alignment.Center,
                ) {
                    FilledTonalButton(onClick = { play = true }) {
                        Icon(Icons.Outlined.PlayArrow, null)
                        Text("Play video")
                    }
                }
        }
        else ->
            TextButton(
                onClick = { model.openPublicationMedia(media) },
                modifier = Modifier.padding(12.dp),
            ) {
                Icon(Icons.Outlined.Description, null)
                Text(media.optString("name", "Open document"))
            }
    }
}

@Composable
private fun NativeVideo(model: CommunityModel, uri: String) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current
    val player =
        remember(uri) {
            ExoPlayer.Builder(context)
                .setMediaSourceFactory(
                    androidx.media3.exoplayer.source.DefaultMediaSourceFactory(
                        androidx.media3.datasource.DefaultHttpDataSource.Factory()
                            .setDefaultRequestProperties(mapOf("Cookie" to model.mediaCookie()))
                    )
                )
                .build()
                .apply {
                    setMediaItem(MediaItem.fromUri(uri))
                    prepare()
                    playWhenReady = true
                }
        }
    DisposableEffect(player, lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) player.pause()
        }
        lifecycle.lifecycle.addObserver(observer)
        onDispose {
            lifecycle.lifecycle.removeObserver(observer)
            player.release()
        }
    }
    AndroidView(
        factory = { PlayerView(it).apply { this.player = player } },
        modifier = Modifier.fillMaxWidth().height(230.dp),
    )
}

@Composable
private fun ChatScreen(model: CommunityModel) {
    val company = model.chatCompany ?: return
    val id = company.optString("id")
    val connection = model.currentConnection
    val request = model.currentRequest
    val incoming = request?.optString("to_id") == model.company?.optString("id")
    val relationship = model.pages["/companies/$id"]?.optJSONObject("relationship")
    val blocked =
        relationship?.optString("status") == "blocked" || connection?.optBoolean("blocked") == true
    val connected = connection?.optString("status") == "connected" && !blocked
    var draft by rememberSaveable(id) { mutableStateOf("") }
    var mediaJson by rememberSaveable(id) { mutableStateOf("[]") }
    val files = mediaJson.uploadFiles()
    var pendingId by rememberSaveable(id) { mutableStateOf("") }
    var pendingFingerprint by rememberSaveable(id) { mutableStateOf("") }
    val picker =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
            model.pickMedia(uris, false) { selected ->
                MediaFiles.discard(files)
                mediaJson = selected.toJson()
            }
        }
    val path = model.messagePath
    var olderCursors by
        rememberSaveable(connection?.optString("id")) { mutableStateOf(emptyList<String>()) }
    val historyPaths = listOfNotNull(path) + olderCursors.map { "$path?before=$it" }
    val oldestPage = historyPaths.lastOrNull()?.let { model.pages[it] }
    val messages =
        historyPaths
            .flatMap { model.pages[it]?.optJSONArray("messages").objects() }
            .distinctBy { it.optString("id") }
            .sortedBy { it.optLong("sequence") }
    LaunchedEffect(historyPaths.lastOrNull()) { historyPaths.lastOrNull()?.let { model.load(it) } }
    val scroll = rememberLazyListState()
    var lastCount by remember(id) { mutableIntStateOf(0) }
    LaunchedEffect(messages.lastOrNull()?.optString("id"), request?.optString("id")) {
        val nearBottom =
            (scroll.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= lastCount - 2
        if (messages.isNotEmpty() && (lastCount == 0 || nearBottom))
            scroll.animateScrollToItem(
                messages.size - 1 + if (oldestPage?.optBoolean("hasMore") == true) 1 else 0
            )
        lastCount = messages.size
    }
    Column(Modifier.fillMaxSize().background(Color.White)) {
        Text(
            if (connected) "Connected · shared with both company teams"
            else if (request != null) "Message request"
            else "${company.optString("type")} · ${company.optString("location")}",
            Modifier.padding(16.dp),
            style = MaterialTheme.typography.bodySmall,
            color = Muted,
        )
        LazyColumn(
            state = scroll,
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (oldestPage?.optBoolean("hasMore") == true)
                item(key = "older") {
                    TextButton(
                        onClick = {
                            messages.firstOrNull()?.optString("sequence")?.let {
                                olderCursors = olderCursors + it
                            }
                        }
                    ) {
                        Text("Earlier messages")
                    }
                }
            itemsIndexed(messages, key = { _, message -> message.optString("id") }) { index, message
                ->
                Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    if (
                        index == 0 ||
                            chatDate(messages[index - 1].optString("created_at")) !=
                                chatDate(message.optString("created_at"))
                    )
                        Box(
                            Modifier.fillMaxWidth().padding(vertical = 12.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Surface(color = Pale, shape = RoundedCornerShape(20.dp)) {
                                Text(
                                    chatDate(message.optString("created_at")),
                                    Modifier.padding(horizontal = 12.dp, vertical = 5.dp),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = Muted,
                                )
                            }
                        }
                    ChatMessage(
                        model,
                        message,
                        index == messages.lastIndex,
                        model.pages[path]?.optLong("peerReadSequence") ?: 0L,
                    )
                }
            }
            if (request != null)
                item {
                    MessageBubble(
                        request.optString("note").ifBlank { "We’d like to connect." },
                        request.optString("author_name"),
                        !incoming,
                    )
                }
            if (messages.isEmpty() && request == null)
                item {
                    Column(
                        Modifier.fillMaxWidth().padding(top = 40.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        CompanyAvatar(company, 60)
                        Text(
                            "Message ${company.optString("name")}",
                            style = MaterialTheme.typography.titleMedium,
                        )
                    }
                }
        }
        HorizontalDivider()
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            when {
                blocked -> Text("New messages are unavailable for this company.", color = Muted)
                request != null && incoming -> {
                    Text(
                        "Accept to connect your companies and start chatting.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    if (model.admin)
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            ConnectOutlinedButton(
                                enabled = !model.busy,
                                onClick = { model.respond(request, "decline") },
                            ) {
                                Text("Decline")
                            }
                            ConnectButton(
                                enabled = !model.busy,
                                onClick = { model.respond(request, "accept") },
                            ) {
                                Text("Accept & connect")
                            }
                        }
                    else Text("A company administrator can accept this request.", color = Muted)
                }
                request != null -> {
                    Text(
                        "Request sent. You can chat once they accept.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    if (model.admin)
                        TextButton(
                            enabled = !model.busy,
                            onClick = { model.respond(request, "withdraw") },
                        ) {
                            Text("Withdraw request")
                        }
                }
                !connected && !model.admin ->
                    Text("A company administrator can send a message request.", color = Muted)
                else -> {
                    if (!connected)
                        Text(
                            "Your first message is a request. Acceptance connects both companies.",
                            style = MaterialTheme.typography.bodySmall,
                            color = Muted,
                        )
                    if (files.isNotEmpty())
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            files.forEach { file ->
                                Box(
                                    Modifier.size(74.dp)
                                        .clip(RoundedCornerShape(12.dp))
                                        .background(Pale)
                                ) {
                                    if (file.mime.startsWith("image/"))
                                        AsyncImage(
                                            java.io.File(file.path),
                                            file.name,
                                            Modifier.fillMaxSize(),
                                            contentScale = ContentScale.Crop,
                                        )
                                    else
                                        Column(
                                            Modifier.fillMaxSize().padding(8.dp),
                                            horizontalAlignment = Alignment.CenterHorizontally,
                                        ) {
                                            Icon(Icons.Outlined.Description, null)
                                            Text(
                                                file.name,
                                                maxLines = 2,
                                                overflow = TextOverflow.Ellipsis,
                                                style = MaterialTheme.typography.labelSmall,
                                            )
                                        }
                                    IconButton(
                                        enabled = !model.busy,
                                        onClick = {
                                            MediaFiles.discard(listOf(file))
                                            mediaJson = (files - file).toJson()
                                        },
                                        modifier =
                                            Modifier.align(Alignment.TopEnd)
                                                .size(26.dp)
                                                .background(Color.White, CircleShape),
                                    ) {
                                        Icon(
                                            Icons.Outlined.Close,
                                            "Remove ${file.name}",
                                            Modifier.size(15.dp),
                                        )
                                    }
                                }
                            }
                        }
                    Row(
                        verticalAlignment = Alignment.Bottom,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        if (connected)
                            IconButton(
                                enabled = !model.busy,
                                onClick = {
                                    picker.launch(
                                        arrayOf(
                                            "image/jpeg",
                                            "image/png",
                                            "image/webp",
                                            "application/pdf",
                                        )
                                    )
                                },
                                modifier =
                                    Modifier.padding(bottom = 4.dp)
                                        .size(40.dp)
                                        .background(Pale, CircleShape),
                            ) {
                                Icon(
                                    Icons.Outlined.Add,
                                    "Attach a file",
                                    Modifier.size(23.dp),
                                    tint = Navy,
                                )
                            }
                        OutlinedTextField(
                            draft,
                            onValueChange = {
                                if (!model.busy && it.length <= if (connected) 10000 else 2000)
                                    draft = it
                            },
                            placeholder = {
                                Text(
                                    if (connected) "Write a message…" else "Say hello…",
                                    style = MaterialTheme.typography.bodyMedium,
                                )
                            },
                            modifier = Modifier.weight(1f),
                            maxLines = 5,
                            shape = RoundedCornerShape(24.dp),
                            colors =
                                OutlinedTextFieldDefaults.colors(
                                    unfocusedBorderColor = Color(0xFFDCE6EF),
                                    unfocusedContainerColor = Color(0xFFF9FBFD),
                                ),
                        )
                        FilledIconButton(
                            enabled =
                                !model.busy &&
                                    (draft.isNotBlank() || connected && files.isNotEmpty()),
                            onClick = {
                                if (connected && path != null) {
                                    val fingerprint = draft + "\n" + mediaJson
                                    if (pendingFingerprint != fingerprint || pendingId.isBlank()) {
                                        pendingFingerprint = fingerprint
                                        pendingId = java.util.UUID.randomUUID().toString()
                                    }
                                    model.sendText(path, draft, files, pendingId) {
                                        draft = ""
                                        mediaJson = "[]"
                                        pendingId = ""
                                        pendingFingerprint = ""
                                    }
                                } else model.sendRequest(draft) { draft = "" }
                            },
                            modifier = Modifier.padding(bottom = 3.dp).size(46.dp),
                        ) {
                            if (model.busy)
                                CircularProgressIndicator(
                                    Modifier.size(18.dp),
                                    strokeWidth = 2.dp,
                                    color = Color.White,
                                )
                            else
                                Icon(
                                    Icons.AutoMirrored.Outlined.Send,
                                    if (connected) "Send" else "Send request",
                                    Modifier.size(20.dp),
                                )
                        }
                    }
                    if (!connected)
                        Text(
                            "Send request",
                            Modifier.align(Alignment.End),
                            style = MaterialTheme.typography.labelSmall,
                            color = Muted,
                        )
                }
            }
        }
    }
}

@Composable
private fun MessageBubble(body: String, author: String, own: Boolean) {
    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = if (own) Alignment.End else Alignment.Start,
    ) {
        Text(
            author,
            Modifier.padding(horizontal = 4.dp, vertical = 4.dp),
            style = MaterialTheme.typography.labelSmall,
            color = Muted,
        )
        Surface(
            shape = ConnectCardShape,
            color = if (own) Navy.copy(alpha = .10f) else Pale,
            modifier = Modifier.widthIn(max = 310.dp),
        ) {
            Text(body, Modifier.padding(12.dp), style = MaterialTheme.typography.bodyMedium)
        }
    }
}

private fun String.uploadFiles() =
    JSONArray(this).objects().map {
        UploadFile(it.getString("path"), it.getString("name"), it.getString("mime"))
    }

private fun List<UploadFile>.toJson() =
    JSONArray(map { JSONObject().put("path", it.path).put("name", it.name).put("mime", it.mime) })
        .toString()

@Composable
private fun AttachmentPicker(
    model: CommunityModel,
    post: Boolean,
    files: List<UploadFile>,
    change: (List<UploadFile>) -> Unit,
) {
    val picker =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
            model.pickMedia(uris, post) { selected ->
                MediaFiles.discard(files)
                change(selected)
            }
        }
    Column {
        files.forEach { file ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    if (file.mime.startsWith("video/")) Icons.Outlined.Videocam
                    else Icons.Outlined.AttachFile,
                    null,
                    Modifier.size(18.dp),
                )
                Text(
                    file.name,
                    Modifier.weight(1f).padding(horizontal = 8.dp),
                    style = MaterialTheme.typography.labelMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                IconButton(
                    enabled = !model.busy,
                    onClick = {
                        MediaFiles.discard(listOf(file))
                        change(files - file)
                    },
                ) {
                    Icon(Icons.Outlined.Close, "Remove ${file.name}", Modifier.size(18.dp))
                }
            }
        }
        TextButton(
            enabled = !model.busy,
            onClick = {
                picker.launch(
                    if (post)
                        arrayOf(
                            "image/jpeg",
                            "image/png",
                            "image/webp",
                            "video/mp4",
                            "video/webm",
                            "application/pdf",
                        )
                    else arrayOf("image/jpeg", "image/png", "image/webp", "application/pdf")
                )
            },
        ) {
            Icon(Icons.Outlined.AttachFile, null, Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text(
                if (files.isNotEmpty()) "Change attachments"
                else if (post) "Photo, video or document" else "Attach a file"
            )
        }
    }
}
