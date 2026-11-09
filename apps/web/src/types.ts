export type Company = {
  id: string;
  slug: string;
  username?: string | null;
  logo_url?: string;
  employee_count?: string;
  name: string;
  tagline: string;
  description: string;
  type: string;
  location: string;
  service_areas: string[];
  services: string[];
  website: string;
  cover_url: string;
  logo_style: string;
  established?: number;
  role?: "owner" | "admin" | "member";
  title?: string;
  listing_status?: "unclaimed" | "managed";
  audiences?: string[];
  phone?: string;
  source_url?: string;
  source_checked_at?: string;
  ownership_verified_at?: string;
  is_demo?: boolean;
  rating_average?: number | null;
  review_count?: number;
  certification_count?: number;
  certifications?: Pick<
    Credential,
    "id" | "title" | "category" | "scope" | "scope_detail" | "evidence_basis"
  >[];
  directory_profile_count?: number;
  directory_profiles?: Pick<
    Credential,
    "id" | "title" | "organization" | "scope_detail" | "evidence_basis"
  >[];
};
export type Session = {
  user: null | {
    id: string;
    name: string;
    email: string;
    account_type?: "company" | "individual";
    email_verified_at?: string | null;
    onboarding_completed_at?: string | null;
    sunhubLinked?: boolean;
    hasPassword?: boolean;
  };
  verificationRequired?: boolean;
  challengeId?: string;
  companies: Company[];
  activeCompanyId: string | null;
};
export type Relationship = {
  status:
    | "none"
    | "self"
    | "sent"
    | "incoming"
    | "connected"
    | "disconnected"
    | "blocked";
  connectionId?: string;
  requestId?: string;
  blockedByMe?: boolean;
};
export type Project = {
  id: string;
  name: string;
  description: string;
  location: string;
  size: string;
  image_url: string;
  completed_year?: number | null;
  url?: string;
};
export type Achievement = {
  id: string;
  title: string;
  issuer: string;
  year: number | null;
  description: string;
  url: string;
};
export type Rating = {
  average: number | null;
  count: number;
  distribution: { rating: number; count: number }[];
};
export type Profile = {
  credentials?: Credential[];
  company: Company;
  projects: Project[];
  team: { id: string; name: string; title: string }[];
  relationship: Relationship;
  achievements: Achievement[];
  rating: Rating;
};
export type Credential = {
  id: string;
  catalog_key: string | null;
  category:
    "certification" | "qualification" | "ranking" | "directory" | "membership";
  title: string;
  organization: string;
  scope: "company" | "product" | "personnel";
  scope_detail: string;
  description: string;
  source_url: string;
  evidence_basis: "issuer" | "company" | "directory";
  period: string;
  valid_until: string | null;
  checked_at: string | null;
};
export type ConnectionRequest = {
  id: string;
  kind: "connection" | "message";
  from_id: string;
  to_id: string;
  note: string;
  created_at: string;
  company: Company;
  author_name: string;
};
export type Connection = {
  id: string;
  status: string;
  company: Company;
  unread: number;
  last_message?: string;
  last_message_at?: string;
  created_at: string;
  blocked: boolean;
};
export type Notification = {
  id: string;
  type: string;
  text: string;
  read_at: string | null;
  created_at: string;
  related_company_id: string;
};
export type Network = {
  incoming: ConnectionRequest[];
  sent: ConnectionRequest[];
  connections: Connection[];
  blocked: { blocked_id: string; company: Company }[];
  notifications: Notification[];
};
export type Message = {
  id: string;
  sequence: string;
  body: string;
  sender_company_id: string;
  author_name: string;
  sender_company_name: string;
  created_at: string;
  attachments: { id: string; name: string; size: number; mime: string }[];
};
export const emptyNetwork: Network = {
  incoming: [],
  sent: [],
  connections: [],
  blocked: [],
  notifications: [],
};
