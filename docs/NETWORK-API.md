# Network v2 API

Base `/api/network-v2` (gateway to Rust `/network-v2`). Cookie session authentication, CSRF enforced by gateway. All requests and responses use **snake_case**. Every mutation uses the real signed-in user/current company; never send a persona. Company publishing/hosting requires owner/admin. Reads are signed-in. Demo companies see the demo partition only. Lists `{items: [...], next_cursor: string|null}`; cursor is the last sequence/id; query limit 1–50 (default20). Errors `{error: string}` with 400/401/403/404/409.

## Shared shapes

Company `{id,name,slug,logo_url,tagline,location,is_demo}`. User `{id,name}` (emails only host invitation/member management).
Community `{id,sequence,name,description,visibility:'public'|'private',join_policy:'open'|'approval',rules:[{title,body}],topics:[Topic],require_topic,archived_at,cover_url,company:Company,membership:null|{role:'admin'|'moderator'|'member',status:'joined'|'pending'|'removed'},member_count,can_manage,can_moderate,can_post,can_read,version}`.
Topic `{id,label,version,fields:[{id,label,type:'text'|'number'|'date'|'select',required,placeholder,unit,min?,step?,options?:string[]}]}`. IDs UUIDs from `crypto.randomUUID()`, retained when renamed. Saving topics increments versions server-side.
Post `{id,sequence,community_id,company_id,author_id,kind:'post'|'question'|'sourcing'|'available',title,body,topic_id,topic_label,topic_version,answers:[{field_id,label,type,unit,value}],media_format:'4:5'|'1:1'|'1.91:1'|'3:4',comments_open,sourcing_status:'open'|'sourced'|'unavailable',created_at,updated_at,version,company,author,community_name,files:[File],reaction_count,comment_count,liked,saved,can_edit,can_delete,can_comment,can_moderate,pinned,source_job_id}`.
File `{id,name,mime_type,size_bytes,url,width?,height?}`. URLs authorized `/api/network-v2/files/:id`. Do not render arbitrary client file URLs.
Comment `{id,sequence,post_id,parent_id,body,deleted_at,created_at,updated_at,version,author,company,can_edit}`. Deleted body is empty; children retained. `parent_id` max one level.

## Main

- `GET /bootstrap` → `{viewer:{id,name,email_verified,company:Company|null,can_publish,can_host,is_platform_admin},communities:Community[],suggested_companies:Company[],following_company_ids:string[],unread_count,draft_count}`. Communities list current memberships (max100); discover separately paginated.
- `GET /posts?cursor=&limit=&company_id=&community_id=&saved=true&following=true&q=&topic_id=` → post list. company feed default, community only with `community_id`.
- `GET /posts/:id` → `{post}`.
- `POST /posts` `{client_id:UUID,community_id?:UUID,kind,title,body,topic_id?,topic_version?,answers:[{field_id,value}],file_ids:UUID[],media_format,comments_open}` → `{post}`. `client_id` idempotency. Resumed drafts may supply `draft_id` and `draft_version`; only that exact version is cleared. A community post requires membership; company post requires publisher.
- `PATCH /posts/:id` same editable fields plus `{version}` → `{post}`. Omitting `file_ids` preserves files; published file replacement not supported. Requires current version, author for discussions, publisher for company posts.
- `DELETE /posts/:id` `{version}` → `{ok:true}` soft delete.
- `POST /posts/:id/state` `{action:'save'|'like'|'hide',value:boolean}` OR `{action:'comments',value:boolean}` OR `{action:'sourcing',value:'open'|'sourced'|'unavailable'}` → `{ok:true}`.
- `POST /posts/:id/report` `{reason,details}` → `{ok:true}`.
- `GET /posts/:id/comments?cursor=&limit=` → comment list (chronological).
- `POST /posts/:id/comments` `{client_id:UUID,body,parent_id?:UUID}` → `{comment}`.
- `PATCH /comments/:id` `{version,body}` → `{comment}`; `DELETE` `{version}` → `{ok:true}`.
- `GET /companies?q=&cursor=&limit=&suggested=true` → suggested/followable company list (includes `following`). `POST /companies/:id/follow` `{following:boolean}` → `{ok:true}`.
- `GET /mentions?q=&community_id=` → `{items:[{id,name,kind:'company'|'user'}]}`. Only accessible identities. Mention text remains plain text; optionally post/comment body supplies `mention_user_ids:UUID[],mention_company_ids:UUID[]` (server validates community access).

## Drafts/media

- `GET /drafts` → `{items:[{id,version,community_id,company_id,updated_at,body:{...PostInput},files:File[],can_publish}],next_cursor}`.
- `GET /drafts/:clientUUID` → `{draft}` for the exact owned draft, including attachments and `can_publish`; independent of list pagination. Missing/foreign drafts return404.
- `PUT /drafts/:clientUUID` `{version:0 for new,body:{...PostInput}}` → `{draft}`. 409 stale; server persistent author+company ownership. `DELETE` `{version}`.
- `POST /files?name=encoded&community_id=optional&purpose=post|cover` raw PDF/JPEG/PNG/WebP bytes, correct Content-Type; max12MB → `{file}`. Unattached files private to uploader. Cover upload requires host. Upload before publishing, pass ids. Retry can include `upload_id=UUID` for idempotency.
- `GET /files/:id` binary guarded download. File URLs become readable only under accessible post/community; private access revoked on removal.
- `POST /posts/:id/job-draft` `{title,description,location,start_window,file_ids:[]}` → `{job_id,url:'/jobs/:id/edit'}`. Author only; idempotent per post; nothing published. Explicit selected files only.

## Communities

- `GET /communities?q=&cursor=&limit=&joined=true` → community list.
- `POST /communities` `{name,description,visibility,join_policy,rules,topics,require_topic,cover_file_id?}` → `{community}`. Current company owner/admin becomes community admin.
- `GET /communities/:id` → `{community}`. Private nonmembers see metadata/rules, never posts/members/files.
- `PATCH /communities/:id` same fields plus `{version,archived?:boolean}` → `{community}`; partial updates allowed. Host/admin only.
- `POST /communities/:id/membership` `{action:'join'|'cancel'|'leave'}` → `{community}`. Open join or pending request, last-admin protection.
- `GET /communities/:id/members?status=joined|pending|removed&cursor=&limit=` → `{items:[{user_id,name,email,company_name,role,status,created_at}],next_cursor}`. Admin/mod only.
- `POST /communities/:id/members/:user_id` `{action:'approve'|'reject'|'remove'|'role',role?:'admin'|'moderator'|'member'}` → `{ok:true}`. Moderators approve/reject ordinary members; admin manages roles/admin removal. Last admin guard.
- `GET /communities/:id/invitations` → `{items:[{id,email,role,status,expires_at,created_at}],next_cursor}`.
- `POST /communities/:id/invitations` `{email,role:'member'|'moderator'|'admin'}` → `{invitation,invite_url}`. Link copy/share UI. **Email delivery is not implicit**; gateway handles authorized email if added. Existing verified users get an in-app notification. Invitation URL `/network/invitations/:token`.
- `POST /communities/:id/invitations/:id` `{action:'revoke'|'renew'}` → `{invitation,invite_url?}`; renew rotates secret and expiry.
- `GET /invitations/:token` → `{invitation:{id,email,role,status,expires_at},community,can_accept,email_matches}`. Signed-in and matching email; mismatch redacts invited email.
- `POST /invitations/:token` `{action:'accept'|'decline'}` → `{community_id,status}`. Verified matching email, unexpired single-use, correct demo partition. Never switches user identity.
- `GET /communities/:id/reports?status=open|resolved&cursor=` → `{items:[{id,post_id,post_title,reason,details,reporter_name,status,resolution_reason,created_at,resolved_at}],next_cursor}`.
- `POST /reports/:id/resolve` `{decision:'keep'|'remove',reason}` → `{ok:true}`. Scoped moderator or platform admin for company posts. Immutable audit retained.
- `GET /admin/reports` same for platform admin company-post queue. No admin by account name.

## Notifications

- `GET /notifications?unread=true&cursor=&limit=` → `{items:[{id,sequence,type,title,body,url,post_id,community_id,created_at,read_at}],next_cursor,unread_count}`.
- `POST /notifications/read` `{ids:UUID[]}` → `{ok:true,unread_count}`. Client marks visible after dwell; max100ids, recipient-only.
- `GET /notification-preferences` / `PUT` `{replies,mentions,community_posts,company_posts}` → `{preferences}`.

## Additional implemented details

- Community detail includes `pinned_posts:[{id,title,body,kind}]` for readable communities. Up to three discussions can be pinned. They remain in the ordinary chronological list too; the pinned section is separate so cursor pagination is stable.
- `POST /posts/:id/state` additionally supports `{action:'pin',value:boolean}` and `{action:'moderate',value:'remove',reason}` for authorized community moderators. `comments` is available to the author or scoped moderator. Removal keeps the internal moderation record.
- Community settings accept `cover_file_id:null` to remove a cover, omission retains it. Private communities always require approval to join.
- Draft responses include `files:[File]` for recoverable attachments; files are withheld if destination access is lost, while the writer's private draft text is retained. `draft_id` + `draft_version` on publication clears only the published version.
- `can_comment` is false for unverified/company-less viewers, public-community readers who have not joined, archived communities and closed posts.
- Notifications use existing `user_notifications` rows with `type=network_*` and `source_kind=network_post|network_community|network_invitation`. All content is generic; read visibility is rechecked against current permissions. Existing push and SSE infrastructure receives those same events. Fan-out is transactional and set-based.
- Sourcing file copies are independent physical job files. Source membership changes/deletion cannot expose additional files or break the explicitly copied draft attachments. `source_job_id` is returned only to the original author in its company context.

- Posts and comments include server-resolved `mentions:[{id,kind:"user"|"company",name}]`. Mentions require matching `@Name` text; user recipients must have access and company recipients are verified owners/admins with discussion access. Existing mentions are not re-notified on copy edits. Bootstrap suggestions exclude the current company and every followed company, with up to 12 candidates for the three visible follow cards.
