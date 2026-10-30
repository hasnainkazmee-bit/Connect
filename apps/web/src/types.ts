export type Company = {
  id: string;
  slug: string;
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
};
export type Session = {
  user: null | { id: string; name: string; email: string; email_verified_at?: string | null; onboarding_completed_at?: string | null };
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
};
export type Profile = {
  company: Company;
  projects: Project[];
  team: { id: string; name: string; title: string }[];
  relationship: Relationship;
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
