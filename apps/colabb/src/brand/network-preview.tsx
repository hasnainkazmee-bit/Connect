import { ArrowRight } from "lucide-react";
import { NetworkPostCard } from "../network/feed";
import { CommunityHeader, DiscussionRow } from "../network/communities";
import type { Community, CommunityPost } from "../network/community-data";
import type { NetworkPost } from "../network/types";
import "../network/styles.css";
import "../network/community.css";

// Illustrative content is kept separate from live Network data. The rendered
// cards, media, controls and community rows are the production components.
const company = {
  id: "marketing-colabb",
  name: "Colabb",
  slug: "colabb",
  logo_url: "/brand/marks/symbol-orange.svg",
};
const post: NetworkPost = {
  id: "marketing-post",
  version: 1,
  kind: "post",
  company_id: company.id,
  company,
  author_id: "marketing-author",
  author: { id: "marketing-author", name: "Colabb team" },
  title: "",
  body: "From roof planning to the final electrical checks, a good installation takes a team. Share the projects your company works on and the experience behind them.",
  created_at: "2026-11-19T08:00:00Z",
  comments_open: true,
  sourcing_status: "open",
  reaction_count: 0,
  comment_count: 0,
  liked: false,
  saved: false,
  can_edit: false,
  can_delete: false,
  can_comment: true,
  answers: [],
  media_format: "1.91:1",
  files: [
    {
      id: "marketing-rooftop",
      name: "Rooftop installation",
      mime_type: "image/webp",
      size_bytes: 0,
      url: "/brand/roof.webp",
    },
  ],
};
const sourcingPost: CommunityPost = {
  id: "marketing-sourcing",
  kind: "sourcing",
  company,
  author: post.author,
  created_at: post.created_at,
  title: "200 × 450 W modules needed in Ohio",
  body: "We’re sourcing modules for a commercial rooftop. Can anyone help with available stock?",
  topic_label: "Modules",
  post_type_label: "Looking for equipment",
  files: [],
  comment_count: 0,
  reaction_count: 0,
  answers: [
    {
      field_id: "quantity",
      type: "number",
      label: "Quantity",
      value: "200",
      unit: "modules",
    },
    {
      field_id: "area",
      type: "text",
      label: "Delivery area",
      value: "Cleveland, OH",
    },
    { field_id: "date", type: "date", label: "Needed by", value: "15 January" },
  ],
};
const community: Community = {
  id: "marketing-community",
  name: "Equipment sourcing",
  description: "Find equipment. Compare options. Share what works.",
  company,
  visibility: "public",
  join_policy: "open",
  member_count: 1,
  membership: null,
  can_manage: false,
  can_moderate: false,
  can_post: false,
  can_read: true,
  topics: [],
  post_types: [],
  require_topic: false,
  rules: [],
  version: 1,
};

export function NetworkMarketingPreview({
  kind = "feed",
  onEnter = () => {},
}: {
  kind?: string;
  onEnter?: () => void;
}) {
  return (
    <div
      className="mx-app-preview nw-root"
      aria-label="Interactive Network example"
    >
      <div className="mx-network-example-label">
        <span>
          {kind === "communities" ? "Community discussion" : "Company post"}
        </span>
        <span>Example content</span>
      </div>
      {kind === "communities" ? (
        <div className="nc-detail nc-panel">
          <CommunityHeader
            community={community}
            headingLevel={3}
            action={
              <button className="nc-btn" onClick={onEnter}>
                Join <ArrowRight size={15} />
              </button>
            }
          />
          <div className="nc-discussion-list">
            <DiscussionRow post={sourcingPost} onOpen={onEnter} />
          </div>
        </div>
      ) : (
        <NetworkPostCard
          post={post}
          actions={{
            onPost: onEnter,
            onFile: onEnter,
            onNavigate: onEnter,
            onState: async () => {}, // Like/save/hide apply only to this local example.
            fileUrl: (file) => file.url,
          }}
        />
      )}
      <p className="mx-app-preview-note">
        {kind === "communities"
          ? "Hosts choose the topics, post types and fields. Sign in to join real discussions."
          : "Try liking or saving this example. Sign in to follow companies and join the conversation."}
      </p>
    </div>
  );
}
