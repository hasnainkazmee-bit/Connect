export const helpTopics: Record<
  string,
  { title: string; intro: string; sections: [string, string][] }
> = {
  help: {
    title: "How to use Colabb.",
    intro:
      "Find help with jobs, company profiles, messages, posts and communities.",
    sections: [
      [
        "Hiring a company",
        "Post a job with the scope, location, timing and supporting files. Add questions for providers and a checklist of the work. Review matches, invite companies and compare their proposals before choosing one.",
      ],
      [
        "Finding work",
        "Search jobs by work and location. Save opportunities, prepare a proposal and answer the hirer’s questions. Your company can hire on one job and provide services on another.",
      ],
      [
        "Working together",
        "Keep messages, documents and decisions in the job conversation. Only the chosen company can submit checklist proof. The hirer reviews it and approves it or requests changes.",
      ],
      [
        "Company posts and your feed",
        "Open Network to follow companies and see their posts. Publish photos and news from your own company profile. React, comment, mention people and save posts you want to find again.",
      ],
      [
        "Communities",
        "Discover communities in Network and join the discussions relevant to your work. Your company can also host a community. Hosts manage its rules, membership, topics, post types and the extra fields members fill in when posting. Private communities require approval to join.",
      ],
      [
        "Messaging another company",
        "Open a company profile with the On Colabb mark and choose Message company. Your company owner or administrator can send the first request. Once the other company accepts, both teams can reply and share files in Inbox → Companies. Job-specific conversations stay with the job.",
      ],
      [
        "Joining a company",
        "Claim your company profile or create one during setup. To join an existing team, ask its owner or administrator to invite your work email. An administrator invitation controls access; a public profile does not.",
      ],
      [
        "Getting help",
        "For an issue with a job, use Report a problem on its page. For account access or platform support, use the contact options on sunhub.com and include the page address and a description of the issue. Never include your password.",
      ],
    ],
  },
  trust: {
    title: "Know who you’re working with.",
    intro:
      "A clear distinction between a company’s presence, its experience and its credentials.",
    sections: [
      [
        "On Colabb",
        "This mark means the company manages its account here. It does not certify the company’s skills, insurance or suitability for a particular job.",
      ],
      [
        "Public listings",
        "Public listings help you discover companies. An unclaimed company cannot respond in Colabb until its team joins. Review its official website and profile sources.",
      ],
      [
        "Reviews and work history",
        "Job reviews come from the other company after a completed job. General customer reviews are displayed separately. Completed jobs and repeat hirers reflect recorded Colabb work, not work completed elsewhere.",
      ],
      [
        "Credentials",
        "Review credential details, issuers, scope and expiry dates. A directory listing is different from a professional qualification. Confirm the requirements for your job directly before agreeing work.",
      ],
    ],
  },
  privacy: {
    title: "Your information in Colabb.",
    intro: "What the product displays and how access works.",
    sections: [
      [
        "Public company information",
        "Company profiles, services, project examples and public reviews can be viewed by visitors. Public job briefs may be browsed by providers. Keep sensitive information out of public descriptions.",
      ],
      [
        "Private job information",
        "Exact site addresses, proposals and private job attachments are restricted to the participants allowed by the job workflow. Company owners and administrators control team access.",
      ],
      [
        "Company messages",
        "Company conversations in Inbox are visible to members of the two participating companies. Owners and administrators manage message requests and can block further contact.",
      ],
      [
        "Network posts and communities",
        "Company posts can be read by people on Colabb. Public community discussions are readable by people on Colabb; private discussions and files require approved membership. Community hosts set rules and manage members. Check the audience before posting.",
      ],
      [
        "Accounts and notifications",
        "Colabb uses account details and secure session cookies for sign-in. Verification and password recovery use email. Browser notifications require permission and can be managed in Account settings.",
      ],
      [
        "Correction and account requests",
        "Edit company information in company settings. Use the contact options on sunhub.com for privacy or account requests. This page describes product behavior; contact us if you need further information before sharing sensitive material.",
      ],
    ],
  },
  payments: {
    title: "Agree the work. Record the payment.",
    intro:
      "Colabb supports the agreement and its progress. Payments are arranged directly between the companies.",
    sections: [
      [
        "Before choosing a company",
        "Read the proposal, included and excluded work, timing, files and payment terms. Ask for a revision when the details need to change. Choosing and confirming a proposal records the agreed version.",
      ],
      [
        "Changes to the work",
        "Use the job workflow to propose and approve scope changes. Keep the agreed scope and any revised price together so both teams have the same record.",
      ],
      [
        "Invoices and receipts",
        "Payment stages record invoice details, a reported payment and the other company’s confirmation of receipt. A payment report alone is not a confirmed receipt.",
      ],
      [
        "No escrow or payment processing",
        "Colabb does not hold funds, collect card payments or provide escrow. Agree payment method, taxes and commercial terms directly with the other company.",
      ],
      [
        "Completion",
        "The provider submits proof. The hirer approves the tasks and accepts the final work. Both companies can then leave a job review.",
      ],
    ],
  },
  accessibility: {
    title: "Made to work for more people.",
    intro: "Clear controls, readable content and predictable navigation.",
    sections: [
      [
        "Using the interface",
        "Use Tab to move through controls and Enter or Space to activate them. Focus indicators show where you are. Page layouts adapt to smaller screens and browser zoom.",
      ],
      [
        "Files and movement",
        "Images and documents open in a full-page viewer with a close or back action. Reduced-motion preferences are respected. Original files are available to authorized participants.",
      ],
      [
        "Tell us what gets in the way",
        "Use the contact options on sunhub.com and include the page, device and assistive technology involved. Please describe the task you were trying to complete so we can investigate.",
      ],
    ],
  },
};
