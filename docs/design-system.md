# Connect interface system

Connect is a place to see companies doing real work: project updates, launches, milestones, and press releases. Company identity and the work should lead each screen. Follower counts and engagement controls should support the content rather than dominate it.

## Shared foundation

`apps/web/src/design-system.css` defines the shared tokens and controls. Import it after the legacy shell, account, profile, management, directory, network, and messaging styles. The feed stylesheet may follow it and owns the feed's component layout. New feature styles should use these tokens rather than defining another primary color.

| Purpose                    | Token / value              | Rule                                                                                                    |
| -------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------- |
| Primary action             | `--brand: #ff6b0b`         | Sign in, publish, save, and send share one treatment.                                                   |
| Primary action text        | `--on-brand: #1c2d3a`      | Dark text keeps orange buttons readable. White text on this orange lacks adequate normal-text contrast. |
| Text link / selected label | `--brand-ink: #974100`     | The darker related color is readable on a light surface.                                                |
| Selected background        | `--brand-soft: #fff0e2`    | Subtle supporting accents; the active navigation uses the primary orange.                               |
| App chrome                 | `--surface-muted: #edf4fa` | Retain Connect's pale blue navigation and contextual panels.                                            |
| Content                    | `--surface: #ffffff`       | Clear, quiet reading surface.                                                                           |
| Body text                  | `--ink: #203342`           | Primary content.                                                                                        |
| Supporting text            | `--muted: #586d7f`         | Readable supporting copy; do not fade important information.                                            |
| Control                    | `--control-height: 44px`   | Minimum web control target. Small variants retain the hit area.                                         |
| Control radius             | `--radius-control: 999px`  | Buttons, inputs, and selects share a shape.                                                             |
| Card radius                | `--radius-card: 24px`      | Larger containers use a related radius.                                                                 |
| Spacing                    | 4, 8, 12, 16, 24, 32px     | Reuse this small scale instead of arbitrary offsets.                                                    |

Primary, secondary, selected, and destructive are separate meanings. A destructive control stays red. Success/error indicators retain their semantic colors. The selected navigation item uses the original solar orange, matching primary actions. Capsule buttons and circular icon controls repeat that shape throughout the app. Large cards and dialogs use 24px corners; multiline writing areas keep generous 20–24px corners instead of becoming ellipses. Keyboard focus uses an obvious dark blue outline, independent of selection.

## Adapt to space, not a device name

Do not scale an entire page with CSS `zoom` or `transform: scale()`. Keep text and controls usable, then change the arrangement of the content around them. Do not disable pinch zoom in the viewport metadata.

- Content gutters vary between 16 and 32px. Reading columns stop growing before line lengths become difficult to scan.
- The signed-in main content column has a 720px ceiling. A supporting column can use approximately 264–280px when there is space; the overall signed-in content area is bounded at 1184px.
- The directory lays out as many cards as fit at a minimum card width of 300px. It becomes one column when necessary, without shrinking company names.
- On widths up to 720px, the main navigation stays at the bottom. The logo, account control, and notification control remain at the top. Existing swipe navigation remains available.
- From 721–1100px, the header moves navigation to its own row. Controls keep their target sizes instead of compressing into a crowded one-row header.
- Above 1100px the header can use one row. Very large screens gain breathing room, not stretched paragraphs or oversized controls.
- Profile actions wrap below the identity on phones. Text labels remain visible; buttons do not silently turn into unexplained icons.
- Short landscape windows and dialogs remain scrollable. Dynamic viewport units and safe-area insets support changing browser chrome.

These are Connect's breakpoints, chosen for its actual content. They are not claimed to be Instagram's private layout rules.

## Type and interaction sizes

Use a 16px root with relative font units for new components. Default body copy is 15–16px, longer reading content 16–18px, controls 14px, and supporting metadata 12–13px. Phone body copy should not shrink because the screen is narrower. Headings use bounded fluid sizing; input text stays at least 16px to avoid mobile-browser focus zoom.

Use a minimum 44×44 CSS-pixel hit area on the web, including close, password reveal, send, menus, and media controls. Native Android should use at least 48dp targets. Icons can be smaller inside those targets. Form errors, input labels, and attachment removal affordances must remain visible at narrow widths and enlarged text sizes.

## Publishing and feed composition

There are two creation choices: **Post** and **Press release**. A post is for a concise update and attached project media. A press release is a structured announcement with a headline, optional summary/cover, and rich body content including inline pictures. Existing historical content must remain readable when older format choices are retired.

The composer and feed should expose consistent limits from the shared publication policy, not independent unexplained frontend limits. Show people a useful count or upload limit before they hit it. Preserve an unsent draft when editing or uploads fail.

Feed cards share the same company identity row, content measure, media geometry, and action placement. Press releases get a distinct headline/summary hierarchy within that same rhythm. Keep source images intact: preview crops must offer an uncropped view, and images inside a release preserve their aspect ratio. Videos should not unexpectedly play audio. Media layout should reserve space before loading to reduce jumping.

Responsive image derivatives are a separate storage/API concern. CSS sizing and `loading="lazy"` do not reduce the bytes of an oversized original. Until derivatives exist, do not advertise `srcset` savings or fabricate resized URLs. Keep initial work bounded, lazy-load off-screen media, and use asynchronous decoding where appropriate.

## Verification matrix

Review directory, signed-in feed, company profile, publishing, and account dialogs at 320, 390, 768, 1024, 1440, and 1920px widths, plus a short landscape window. Also verify browser zoom at 200%; a 1440px browser at 200% presents roughly a 720 CSS-pixel layout viewport, but viewport resizing alone is not a full browser zoom accessibility test.

Check that page content has no horizontal overflow, controls remain reachable, visible primary actions use the same tokens, there is a visible keyboard focus indicator, dialogs can scroll, and bottom navigation does not cover the last action. Any intentionally horizontal media carousel or tab strip must scroll within its own container. Test text enlargement separately from physical screen dimensions.

## Source notes

- [Android responsive/adaptive guidance](https://developer.android.com/develop/ui/views/layout/responsive-adaptive-design-with-views) bases layout decisions on available window space and supports alternate arrangements as that space changes. Connect applies that principle to its web layout; CSS pixels and Android dp are not interchangeable measurements.
- [Android touch target guidance](https://support.google.com/accessibility/android/answer/7101858?hl=en) recommends at least 48×48dp for native touch targets.
- [W3C reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) explains preserving content and functionality at a 320 CSS-pixel width without requiring two-dimensional page scrolling.
- [W3C text resizing guidance](https://www.w3.org/WAI/WCAG20/Understanding/resize-text.html) requires text to be resizable to 200% without lost content or functionality.
- [Instagram Engineering, “Making Instagram.com faster: Part 1”](https://medium.com/instagram-engineering/making-instagram-com-faster-part-1-62cc0c327538) describes responsive image selection and careful prioritization of upcoming feed work. This historical engineering article supports the performance principles, not a claim about Instagram's current visual breakpoints or product design.

## Verified on 2 November 2026

The web build was checked at 320, 390, 768, 1024, 1440, and 1920px, with additional 1101/1200px header checks and an 844×390 landscape window. Directory/account controls, signed-in feed, publishing, profiles, and chat were reviewed. Browser regression checks cover gallery navigation, release cover/inline photos, draft restoration, partial upload failure, and permission/session flows.

Actual Chrome page zoom at 200% was also checked in a disposable browser profile: a 1440×1000 window produced a 720×456 layout viewport at DPR 2. The directory, signed-in feed, and press-release editor reflowed without horizontal page or dialog overflow; fields and close controls remained reachable. This was browser zoom, not CSS scaling or pinch zoom.

Functional and layout checks do not establish a real-device performance benchmark. Image derivatives and measured Android frame/startup budgets remain separate work.
