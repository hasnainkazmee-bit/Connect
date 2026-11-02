package com.sunhub.community

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.text.Editable
import android.text.InputType
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.TextPaint
import android.text.TextWatcher
import android.text.style.LeadingMarginSpan
import android.text.style.MetricAffectingSpan
import android.text.style.ReplacementSpan
import android.view.Gravity
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.viewinterop.AndroidView
import coil3.SingletonImageLoader
import coil3.asDrawable
import coil3.network.NetworkHeaders
import coil3.network.httpHeaders
import coil3.request.Disposable
import coil3.request.ImageRequest
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/** Native editing metadata travels with the text, including through selection and IME edits. */
internal data class DocumentAncestor(val id: Int, val template: String)

internal class DocumentBlockSpan(val template: String, val ancestors: List<DocumentAncestor>) :
    MetricAffectingSpan(), LeadingMarginSpan {
    private val node = JSONObject(template)

    override fun updateDrawState(tp: TextPaint) = style(tp)

    override fun updateMeasureState(tp: TextPaint) = style(tp)

    private fun style(tp: TextPaint) {
        when (node.optString("type")) {
            "heading" -> {
                tp.typeface = Typeface.create(tp.typeface, Typeface.BOLD)
                tp.textSize *=
                    when (node.optJSONObject("attrs")?.optInt("level")) {
                        1 -> 1.6f
                        3 -> 1.15f
                        else -> 1.35f
                    }
            }
            "codeBlock" -> tp.typeface = Typeface.MONOSPACE
        }
    }

    override fun getLeadingMargin(first: Boolean) = if (ancestors.isEmpty()) 0 else 32

    override fun drawLeadingMargin(
        c: Canvas,
        p: Paint,
        x: Int,
        dir: Int,
        top: Int,
        baseline: Int,
        bottom: Int,
        text: CharSequence,
        start: Int,
        end: Int,
        first: Boolean,
        layout: android.text.Layout?,
    ) {
        if (!first || ancestors.isEmpty()) return
        val old = p.color
        p.color = 0xff62748a.toInt()
        when {
            ancestors.any { JSONObject(it.template).optString("type") == "blockquote" } ->
                c.drawRect(x.toFloat(), top.toFloat(), (x + 3).toFloat(), bottom.toFloat(), p)
            ancestors.any {
                JSONObject(it.template).optString("type") in listOf("bulletList", "orderedList")
            } -> c.drawCircle((x + dir * 10).toFloat(), (baseline - p.textSize * .3f), 3f, p)
        }
        p.color = old
    }
}

internal class DocumentMarkSpan(val mark: String) : MetricAffectingSpan() {
    val kind: String
        get() = JSONObject(mark).optString("type")

    override fun updateDrawState(tp: TextPaint) = style(tp)

    override fun updateMeasureState(tp: TextPaint) = style(tp)

    private fun style(tp: TextPaint) {
        when (kind) {
            "bold" ->
                tp.typeface =
                    Typeface.create(tp.typeface, (tp.typeface?.style ?: 0) or Typeface.BOLD)
            "italic" ->
                tp.typeface =
                    Typeface.create(tp.typeface, (tp.typeface?.style ?: 0) or Typeface.ITALIC)
            "underline" -> tp.isUnderlineText = true
            "strike" -> tp.isStrikeThruText = true
            "code" -> tp.typeface = Typeface.MONOSPACE
            "link" -> {
                tp.isUnderlineText = true
                tp.color = 0xff153e67.toInt()
            }
        }
    }
}

/** A hard break is distinct from Enter, which creates a new paragraph. */
internal class DocumentHardBreakSpan(val rawText: Boolean = false)

internal class DocumentObjectSpan(val node: String, private val width: () -> Int = { 500 }) :
    ReplacementSpan() {
    var drawable: Drawable? = null
    private val image
        get() = JSONObject(node).optString("type") == "image"

    private fun height(): Int {
        if (!image) return 36
        val d = drawable
        return if (d != null && d.intrinsicWidth > 0)
            (width() * d.intrinsicHeight.toFloat() / d.intrinsicWidth).toInt().coerceAtLeast(1)
        else (width() * .56f).toInt()
    }

    override fun getSize(
        paint: Paint,
        text: CharSequence?,
        start: Int,
        end: Int,
        fm: Paint.FontMetricsInt?,
    ): Int {
        fm?.apply {
            ascent = -height()
            descent = 12
            top = ascent
            bottom = descent
        }
        return width()
    }

    override fun draw(
        canvas: Canvas,
        text: CharSequence?,
        start: Int,
        end: Int,
        x: Float,
        top: Int,
        y: Int,
        bottom: Int,
        paint: Paint,
    ) {
        val h = height()
        val bounds = RectF(x, (y - h).toFloat(), x + width(), y.toFloat())
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xfff2f7fc.toInt() }
        if (!image) {
            p.color = 0xffd9e3ec.toInt()
            canvas.drawRect(x, y - 12f, x + width(), y - 10f, p)
            return
        }
        drawable?.let { d ->
            val scale =
                minOf(
                    bounds.width() / d.intrinsicWidth.coerceAtLeast(1),
                    bounds.height() / d.intrinsicHeight.coerceAtLeast(1),
                )
            val w = (d.intrinsicWidth * scale).toInt()
            val dh = (d.intrinsicHeight * scale).toInt()
            val left = (x + (width() - w) / 2).toInt()
            val t = (y - h + (h - dh) / 2)
            d.setBounds(left, t, left + w, t + dh)
            d.draw(canvas)
        }
            ?: run {
                p.color = 0xff62748a.toInt()
                p.textSize = paint.textSize
                val caption =
                    JSONObject(node).optJSONObject("attrs")?.optString("alt").orEmpty().ifBlank {
                        "Photo"
                    }
                canvas.drawText(caption.take(38), x + 20, y - h / 2f, p)
            }
    }
}

/**
 * Lossless for supported document structures; editing one block retains its neighbors and marks.
 */
internal object RichDocumentCodec {
    private val containers = setOf("blockquote", "bulletList", "orderedList", "listItem")

    private fun template(node: JSONObject) =
        JSONObject(node.toString()).apply { remove("content") }.toString()

    fun decode(document: JSONObject, width: () -> Int = { 500 }): SpannableStringBuilder {
        val result = SpannableStringBuilder()
        data class PendingSpan(val span: Any, val start: Int, val end: Int, val flags: Int)
        val pending = mutableListOf<PendingSpan>()
        fun addSpan(span: Any, start: Int, end: Int, flags: Int) {
            pending.add(PendingSpan(span, start, end, flags))
        }
        var id = 0
        var first = true
        fun visit(node: JSONObject, ancestors: List<DocumentAncestor>) {
            val kind = node.optString("type")
            if (kind in containers && (node.optJSONArray("content")?.length() ?: 0) > 0) {
                val path = ancestors + DocumentAncestor(++id, template(node))
                node.optJSONArray("content").objects().forEach { visit(it, path) }
                return
            }
            if (!first) result.append('\n')
            first = false
            val start = result.length
            if (kind in setOf("paragraph", "heading", "codeBlock")) {
                node.optJSONArray("content").objects().forEach { inline ->
                    val a = result.length
                    when (inline.optString("type")) {
                        "text" -> {
                            val value = inline.optString("text")
                            result.append(value)
                            value.indices
                                .filter { value[it] == '\n' }
                                .forEach { position ->
                                    addSpan(
                                        DocumentHardBreakSpan(rawText = true),
                                        a + position,
                                        a + position + 1,
                                        Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
                                    )
                                }
                        }
                        "hardBreak" -> {
                            result.append('\n')
                            addSpan(
                                DocumentHardBreakSpan(),
                                a,
                                result.length,
                                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
                            )
                        }
                        else -> {
                            result.append('\uFFFC')
                            addSpan(
                                DocumentObjectSpan(inline.toString(), width),
                                a,
                                result.length,
                                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
                            )
                        }
                    }
                    inline.optJSONArray("marks").objects().forEach {
                        addSpan(
                            DocumentMarkSpan(it.toString()),
                            a,
                            result.length,
                            Spanned.SPAN_EXCLUSIVE_INCLUSIVE,
                        )
                    }
                }
            } else {
                result.append('\uFFFC')
                addSpan(
                    DocumentObjectSpan(node.toString(), width),
                    start,
                    result.length,
                    Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
                )
            }
            addSpan(
                DocumentBlockSpan(template(node), ancestors),
                start,
                result.length,
                Spanned.SPAN_INCLUSIVE_INCLUSIVE,
            )
        }
        document.optJSONArray("content").objects().forEach { visit(it, emptyList()) }
        if (first)
            addSpan(
                DocumentBlockSpan("{\"type\":\"paragraph\"}", emptyList()),
                0,
                0,
                Spanned.SPAN_INCLUSIVE_INCLUSIVE,
            )
        pending.forEach { result.setSpan(it.span, it.start, it.end, it.flags) }
        return result
    }

    fun encode(text: Spanned, original: JSONObject): JSONObject {
        val root = JSONObject(original.toString()).put("content", JSONArray())
        var active = emptyList<DocumentAncestor>()
        var stack = listOf(root)
        var start = 0
        val boundaries =
            (text.indices.filter {
                text[it] == '\n' &&
                    text.getSpans(it, it + 1, DocumentHardBreakSpan::class.java).none { s ->
                        text.getSpanStart(s) == it
                    }
            } + text.length)
        boundaries.forEach { end ->
            val meta = metadata(text, start, end)
            var ancestry = meta?.ancestors.orEmpty()
            // Enter within a list item starts another item, preserving the surrounding list.
            if (
                meta != null &&
                    start > text.getSpanStart(meta) &&
                    ancestry.lastOrNull()?.let { JSONObject(it.template).optString("type") } ==
                        "listItem"
            ) {
                ancestry = ancestry.dropLast(1) + ancestry.last().copy(id = -start - 1)
            }
            var common = 0
            while (
                common < minOf(active.size, ancestry.size) && active[common] == ancestry[common]
            ) common++
            stack = stack.take(common + 1)
            ancestry.drop(common).forEach { ancestor ->
                val parent = JSONObject(ancestor.template).put("content", JSONArray())
                stack.last().getJSONArray("content").put(parent)
                stack = stack + parent
            }
            active = ancestry
            val objectSpan =
                text.getSpans(start, end, DocumentObjectSpan::class.java).firstOrNull {
                    text.getSpanStart(it) == start && text.getSpanEnd(it) == end
                }
            val node =
                if (objectSpan != null) JSONObject(objectSpan.node)
                else {
                    val raw = JSONObject(meta?.template ?: "{\"type\":\"paragraph\"}")
                    if (raw.optString("type") !in setOf("paragraph", "heading", "codeBlock")) {
                        raw.put("type", "paragraph")
                        raw.remove("attrs")
                    }
                    if (
                        raw.optString("type") == "heading" &&
                            meta != null &&
                            start > text.getSpanStart(meta)
                    ) {
                        raw.put("type", "paragraph")
                        raw.remove("attrs")
                    }
                    raw.put("content", inline(text, start, end))
                }
            stack.last().getJSONArray("content").put(node)
            start = end + 1
        }
        return root
    }

    internal fun metadata(text: Spanned, start: Int, end: Int): DocumentBlockSpan? =
        text
            .getSpans(start, end, DocumentBlockSpan::class.java)
            .filter {
                text.getSpanStart(it) <= start &&
                    (text.getSpanEnd(it) > start || text.getSpanStart(it) == start)
            }
            .maxByOrNull { text.getSpanStart(it) }

    private fun inline(text: Spanned, start: Int, end: Int): JSONArray {
        val result = JSONArray()
        val marks = text.getSpans(start, end, DocumentMarkSpan::class.java)
        val objects = text.getSpans(start, end, DocumentObjectSpan::class.java)
        val boundaries =
            (listOf(start, end) +
                    marks.flatMap {
                        listOf(
                            text.getSpanStart(it).coerceIn(start, end),
                            text.getSpanEnd(it).coerceIn(start, end),
                        )
                    } +
                    (start until end)
                        .filter {
                            (text[it] == '\n' &&
                                text.getSpans(it, it + 1, DocumentHardBreakSpan::class.java).none {
                                    span ->
                                    span.rawText && text.getSpanStart(span) == it
                                }) || text[it] == '\uFFFC'
                        }
                        .flatMap { listOf(it, it + 1) })
                .distinct()
                .sorted()
        boundaries.zipWithNext().forEach { (a, b) ->
            if (a == b) return@forEach
            val value = text.subSequence(a, b).toString()
            val obj = objects.firstOrNull { text.getSpanStart(it) == a && text.getSpanEnd(it) == b }
            when {
                obj != null -> result.put(JSONObject(obj.node))
                value == "\n" &&
                    text.getSpans(a, b, DocumentHardBreakSpan::class.java).none {
                        it.rawText && text.getSpanStart(it) == a
                    } -> result.put(JSONObject().put("type", "hardBreak"))
                else -> {
                    val node = JSONObject().put("type", "text").put("text", value)
                    val selected =
                        marks
                            .filter { text.getSpanStart(it) <= a && text.getSpanEnd(it) >= b }
                            .associateBy { it.kind }
                            .values
                    if (selected.isNotEmpty())
                        node.put("marks", JSONArray(selected.map { JSONObject(it.mark) }))
                    result.put(node)
                }
            }
        }
        return result
    }

    fun plain(document: JSONObject): String =
        when (document.optString("type")) {
            "text" -> document.optString("text")
            "hardBreak" -> "\n"
            else ->
                document.optJSONArray("content").objects().joinToString(
                    if (document.optString("type") in containers + "doc") "\n" else ""
                ) {
                    plain(it)
                }
        }
}

internal class ContinuousEditorState(initial: String) {
    private var value = initial
    internal var view: DocumentEditText? = null
    var selectionStart = 0
    var selectionEnd = 0
    var onChange: (String) -> Unit = {}
    var onCaretChanged: (RectF) -> Unit = {}

    fun document(): String = value

    fun accept(value: String) {
        this.value = value
        onChange(value)
    }

    fun synchronize(value: String) {
        if (this.value != value) {
            this.value = value
            view?.load(value)
        }
    }

    fun command(command: String) {
        view?.format(command)
    }

    fun hideKeyboard() {
        view?.let {
            (it.context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
                .hideSoftInputFromWindow(it.windowToken, 0)
            it.clearFocus()
        }
    }

    fun insertImage(node: JSONObject) {
        view?.insertImage(node)
            ?: run {
                val d = JSONObject(value)
                d.getJSONArray("content")
                    .put(node)
                    .put(JSONObject().put("type", "paragraph").put("content", JSONArray()))
                accept(d.toString())
            }
    }
}

internal class DocumentEditText(
    context: Context,
    private val state: ContinuousEditorState,
    private val model: CommunityModel?,
) : EditText(context) {
    private var original = JSONObject(state.document())
    private var loading = false
    private var lastLoaded = ""
    private val pendingMarks = linkedMapOf<String, String?>()
    private var changedStart = 0
    private var changedCount = 0
    private val imageLoader = SingletonImageLoader.get(context)
    private val imageRequests = mutableListOf<Disposable>()
    private val pendingImages = mutableSetOf<DocumentObjectSpan>()

    init {
        textSize = 17f
        setTextColor(0xff192936.toInt())
        setHintTextColor(0xff8794a3.toInt())
        background = null
        setPadding(0, 12, 0, 24)
        gravity = Gravity.TOP or Gravity.START
        inputType =
            InputType.TYPE_CLASS_TEXT or
                InputType.TYPE_TEXT_FLAG_MULTI_LINE or
                InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        setSingleLine(false)
        setHorizontallyScrolling(false)
        setLineSpacing(8f, 1.12f)
        minLines = 9
        isVerticalScrollBarEnabled = false
        load(state.document())
        addTextChangedListener(
            object : TextWatcher {
                override fun beforeTextChanged(
                    s: CharSequence?,
                    start: Int,
                    count: Int,
                    after: Int,
                ) {}

                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    changedStart = start
                    changedCount = count
                }

                override fun afterTextChanged(s: Editable?) {
                    if (!loading) {
                        if (
                            changedCount > 0 &&
                                RichDocumentCodec.metadata(
                                        text,
                                        changedStart,
                                        (changedStart + changedCount).coerceAtMost(length()),
                                    )
                                    ?.let { JSONObject(it.template).optString("type") } ==
                                    "codeBlock"
                        ) {
                            (changedStart until
                                    (changedStart + changedCount).coerceAtMost(length()))
                                .filter { text[it] == '\n' }
                                .forEach {
                                    text.setSpan(
                                        DocumentHardBreakSpan(rawText = true),
                                        it,
                                        it + 1,
                                        Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
                                    )
                                }
                        }
                        if (changedCount > 0)
                            pendingMarks.forEach { (kind, mark) ->
                                val end = (changedStart + changedCount).coerceAtMost(length())
                                removeMarkRange(kind, changedStart, end)
                                if (mark != null)
                                    text.setSpan(
                                        DocumentMarkSpan(mark),
                                        changedStart,
                                        end,
                                        Spanned.SPAN_EXCLUSIVE_INCLUSIVE,
                                    )
                            }
                        publish()
                    }
                }
            }
        )
    }

    override fun onSelectionChanged(selStart: Int, selEnd: Int) {
        super.onSelectionChanged(selStart, selEnd)
        // EditText's constructor calls this before our fields are initialized.
        @Suppress("SENSELESS_COMPARISON")
        if (state != null) {
            state.selectionStart = selStart.coerceAtLeast(0)
            state.selectionEnd = selEnd.coerceAtLeast(0)
            post { revealCaret() }
        }
    }

    fun revealCaret() {
        if (!hasFocus() || layout == null) return
        val line = layout.getLineForOffset(selectionEnd.coerceIn(0, length()))
        state.onCaretChanged(
            RectF(
                0f,
                (layout.getLineTop(line) + totalPaddingTop).toFloat(),
                width.toFloat(),
                (layout.getLineBottom(line) + totalPaddingTop + 24).toFloat(),
            )
        )
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        post { revealCaret() }
    }

    fun load(value: String) {
        if (value == lastLoaded) return
        original = JSONObject(value)
        loading = true
        val cursorStart = state.selectionStart
        val cursorEnd = state.selectionEnd
        setText(
            RichDocumentCodec.decode(original) {
                (width - paddingLeft - paddingRight).coerceAtLeast(200)
            }
        )
        setSelection(cursorStart.coerceIn(0, length()), cursorEnd.coerceIn(0, length()))
        loading = false
        lastLoaded = value
        loadImages()
    }

    private fun publish() {
        val encoded = RichDocumentCodec.encode(text, original)
        val value = encoded.toString()
        // Reflow block styles after Enter without replacing the Editable or disturbing IME spans.
        val normalized = RichDocumentCodec.decode(encoded)
        if (normalized.toString() == text.toString()) {
            text.getSpans(0, length(), DocumentBlockSpan::class.java).forEach {
                text.removeSpan(it)
            }
            normalized.getSpans(0, normalized.length, DocumentBlockSpan::class.java).forEach { span
                ->
                text.setSpan(
                    span,
                    normalized.getSpanStart(span),
                    normalized.getSpanEnd(span),
                    Spanned.SPAN_INCLUSIVE_INCLUSIVE,
                )
            }
        }
        lastLoaded = value
        state.accept(value)
        loadImages()
    }

    private fun loadImages() {
        if (model == null) return
        text.getSpans(0, length(), DocumentObjectSpan::class.java).forEach { span ->
            val node = JSONObject(span.node)
            if (
                node.optString("type") != "image" ||
                    span.drawable != null ||
                    !pendingImages.add(span)
            )
                return@forEach
            val path = node.optJSONObject("attrs")?.optString("src").orEmpty()
            val request = ImageRequest.Builder(context).data(mediaUrl(model, path)).size(1200)
            if (path.startsWith("/api/post-media/"))
                request.httpHeaders(
                    NetworkHeaders.Builder().set("Cookie", model.mediaCookie()).build()
                )
            imageRequests +=
                imageLoader.enqueue(
                    request
                        .target(
                            onSuccess = { image ->
                                span.drawable = image.asDrawable(resources)
                                // Reset only the same span to invalidate text layout, never reset
                                // the
                                // cursor or text.
                                val a = text.getSpanStart(span)
                                val b = text.getSpanEnd(span)
                                if (a >= 0 && b > a)
                                    text.setSpan(span, a, b, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                                requestLayout()
                                invalidate()
                            }
                        )
                        .build()
                )
        }
    }

    fun format(command: String) {
        val a = minOf(state.selectionStart, state.selectionEnd).coerceIn(0, length())
        val b = maxOf(state.selectionStart, state.selectionEnd).coerceIn(a, length())
        loading = true
        if (command in setOf("heading", "subheading", "paragraph")) {
            val start = text.toString().lastIndexOf('\n', (a - 1).coerceAtLeast(-1)) + 1
            val end = text.toString().indexOf('\n', b).let { if (it < 0) length() else it }
            val previous = RichDocumentCodec.metadata(text, start, end)
            text.getSpans(start, end, DocumentBlockSpan::class.java).forEach { span ->
                val s = text.getSpanStart(span)
                val e = text.getSpanEnd(span)
                text.removeSpan(span)
                if (s < start)
                    text.setSpan(
                        DocumentBlockSpan(span.template, span.ancestors),
                        s,
                        start - 1,
                        Spanned.SPAN_INCLUSIVE_INCLUSIVE,
                    )
                if (e > end)
                    text.setSpan(
                        DocumentBlockSpan(span.template, span.ancestors),
                        end + 1,
                        e,
                        Spanned.SPAN_INCLUSIVE_INCLUSIVE,
                    )
            }
            val level = if (command == "heading") 2 else 3
            val wasSame =
                previous?.let {
                    JSONObject(it.template).let { n ->
                        n.optString("type") == "heading" &&
                            n.optJSONObject("attrs")?.optInt("level") == level
                    }
                } == true
            val node =
                JSONObject()
                    .put("type", if (command == "paragraph" || wasSame) "paragraph" else "heading")
            if (node.optString("type") == "heading")
                node.put("attrs", JSONObject().put("level", level))
            text.setSpan(
                DocumentBlockSpan(
                    node.toString(),
                    if (command == "paragraph") emptyList() else previous?.ancestors.orEmpty(),
                ),
                start,
                end,
                Spanned.SPAN_INCLUSIVE_INCLUSIVE,
            )
        } else {
            val kind = if (command.startsWith("link:")) "link" else command
            var end = b
            if (a == b && kind != "link") {
                val active =
                    if (pendingMarks.containsKey(kind)) pendingMarks[kind] != null
                    else
                        text.getSpans(a, a, DocumentMarkSpan::class.java).any {
                            it.kind == kind &&
                                text.getSpanStart(it) <= a &&
                                text.getSpanEnd(it) >= a
                        }
                pendingMarks[kind] = if (active) null else JSONObject().put("type", kind).toString()
            }
            if (a == b && kind == "link") {
                val address = command.removePrefix("link:")
                text.insert(a, address)
                end = a + address.length
            }
            if (a < end) {
                val existing =
                    text.getSpans(a, end, DocumentMarkSpan::class.java).filter { it.kind == kind }
                val covered =
                    (a until end).all { pos ->
                        existing.any { text.getSpanStart(it) <= pos && text.getSpanEnd(it) > pos }
                    }
                existing.forEach { span ->
                    val s = text.getSpanStart(span)
                    val e = text.getSpanEnd(span)
                    text.removeSpan(span)
                    if (s < a)
                        text.setSpan(
                            DocumentMarkSpan(span.mark),
                            s,
                            a,
                            Spanned.SPAN_EXCLUSIVE_INCLUSIVE,
                        )
                    if (e > end)
                        text.setSpan(
                            DocumentMarkSpan(span.mark),
                            end,
                            e,
                            Spanned.SPAN_EXCLUSIVE_INCLUSIVE,
                        )
                }
                if (!covered || kind == "link") {
                    val mark = JSONObject().put("type", kind)
                    if (kind == "link")
                        mark.put("attrs", JSONObject().put("href", command.removePrefix("link:")))
                    text.setSpan(
                        DocumentMarkSpan(mark.toString()),
                        a,
                        end,
                        Spanned.SPAN_EXCLUSIVE_INCLUSIVE,
                    )
                }
            }
        }
        loading = false
        publish()
        requestFocus()
        if (a == b && command.startsWith("link:"))
            setSelection((a + command.removePrefix("link:").length).coerceAtMost(length()))
        else setSelection(a.coerceAtMost(length()), b.coerceAtMost(length()))
    }

    fun insertImage(node: JSONObject) {
        val a = minOf(state.selectionStart, state.selectionEnd).coerceIn(0, length())
        val b = maxOf(state.selectionStart, state.selectionEnd).coerceIn(a, length())
        val prefix = if (a > 0 && text[a - 1] != '\n') "\n" else ""
        val inserted = SpannableStringBuilder(prefix + "\uFFFC\n")
        val offset = prefix.length
        inserted.setSpan(
            DocumentObjectSpan(node.toString()) {
                (width - paddingLeft - paddingRight).coerceAtLeast(200)
            },
            offset,
            offset + 1,
            Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
        )
        loading = true
        text.replace(a, b, inserted)
        setSelection(a + inserted.length)
        loading = false
        publish()
    }

    private fun removeMarkRange(kind: String, start: Int, end: Int) {
        text
            .getSpans(start, end, DocumentMarkSpan::class.java)
            .filter { it.kind == kind }
            .forEach { span ->
                val a = text.getSpanStart(span)
                val b = text.getSpanEnd(span)
                text.removeSpan(span)
                if (a < start)
                    text.setSpan(
                        DocumentMarkSpan(span.mark),
                        a,
                        start,
                        Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
                    )
                if (b > end)
                    text.setSpan(
                        DocumentMarkSpan(span.mark),
                        end,
                        b,
                        Spanned.SPAN_EXCLUSIVE_INCLUSIVE,
                    )
            }
    }

    override fun onTouchEvent(event: android.view.MotionEvent): Boolean {
        if (event.action == android.view.MotionEvent.ACTION_DOWN) pendingMarks.clear()
        return super.onTouchEvent(event)
    }

    fun insertText(value: String) {
        val a = minOf(selectionStart, selectionEnd).coerceAtLeast(0)
        val b = maxOf(selectionStart, selectionEnd).coerceAtLeast(a)
        text.replace(a, b, value)
        setSelection(a + value.length)
    }

    fun dispose() {
        imageRequests.forEach { it.dispose() }
        imageRequests.clear()
    }
}

@Composable
internal fun ContinuousDocumentEditor(
    model: CommunityModel,
    state: ContinuousEditorState,
    value: String,
    change: (String) -> Unit,
    hint: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    state.onChange = change
    state.synchronize(value)
    val editableContent =
        state.view?.text?.toString() ?: RichDocumentCodec.decode(JSONObject(value)).toString()
    var editorFocused by remember { mutableStateOf(false) }
    val bringIntoView = remember { BringIntoViewRequester() }
    val scope = rememberCoroutineScope()
    state.onCaretChanged = { rect ->
        scope.launch {
            bringIntoView.bringIntoView(
                androidx.compose.ui.geometry.Rect(rect.left, rect.top, rect.right, rect.bottom)
            )
        }
    }
    AndroidView(
        modifier =
            modifier.bringIntoViewRequester(bringIntoView).semantics {
                text = AnnotatedString(hint)
                editableText = AnnotatedString(editableContent)
                focused = editorFocused
                requestFocus { (state.view?.requestFocus() == true).also { editorFocused = it } }
                setText { content ->
                    state.view?.let {
                        it.selectAll()
                        it.insertText(content.text)
                    }
                    true
                }
                insertTextAtCursor { content ->
                    state.view?.insertText(content.text)
                    true
                }
                setSelection { start, end, _ ->
                    state.view?.setSelection(
                        start.coerceIn(0, state.view!!.length()),
                        end.coerceIn(0, state.view!!.length()),
                    )
                    true
                }
                onClick {
                    state.view?.let {
                        it.requestFocus()
                        (it.context.getSystemService(Context.INPUT_METHOD_SERVICE)
                                as InputMethodManager)
                            .showSoftInput(it, InputMethodManager.SHOW_IMPLICIT)
                    }
                    true
                }
            },
        factory = { context ->
            DocumentEditText(context, state, model).also {
                state.view = it
                it.hint = hint
                it.setOnFocusChangeListener { _, hasFocus ->
                    editorFocused = hasFocus
                    if (hasFocus) it.postDelayed({ it.revealCaret() }, 300)
                }
            }
        },
        update = {
            it.isEnabled = enabled
            it.hint = hint
            it.load(value)
        },
        onRelease = {
            it.dispose()
            if (state.view === it) state.view = null
        },
    )
}
