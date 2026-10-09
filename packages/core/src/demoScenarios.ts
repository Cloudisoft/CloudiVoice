import type { AgentConfig, UseCase } from "./agentConfig";
import { parseAgentConfig } from "./agentConfig";

/**
 * Isolated demo agents for the public website. They use synthetic
 * businesses and never touch production leads, campaigns or credentials.
 */
export interface DemoScenario {
  id: UseCase;
  label: string;
  business: string;
  blurb: string;
  config: (language: string) => AgentConfig;
}

const common = {
  max_duration_sec: 180,
  knowledge_enabled: false,
  transfer_number: "",
  code_switching: true,
};

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "receptionist",
    label: "Receptionist",
    business: "Sunrise Multispeciality Clinic",
    blurb: "Books, reschedules and confirms appointments.",
    config: (language) =>
      parseAgentConfig({
        ...common,
        persona_name: "Ananya",
        company_name: "Sunrise Multispeciality Clinic",
        use_case: "receptionist",
        primary_language: language,
        voice: "priya",
        tone: "warm",
        instructions:
          "Clinic hours: Monday to Saturday, 9 AM to 8 PM. Doctors: Dr. Mehta (general physician, consultation fee five hundred rupees), Dr. Iyer (dermatologist, eight hundred rupees). Offer the next available slots: tomorrow 11:30 AM or 5 PM. Ask for the patient's name and confirm the mobile number on file before booking.",
        goals: ["Understand what the caller needs", "Book or reschedule an appointment", "Confirm date, time and doctor"],
      }),
  },
  {
    id: "sales",
    label: "Sales qualification",
    business: "Skyline Homes",
    blurb: "Qualifies property enquiries and books site visits.",
    config: (language) =>
      parseAgentConfig({
        ...common,
        persona_name: "Rohan",
        company_name: "Skyline Homes",
        use_case: "sales",
        primary_language: language,
        voice: "aditya",
        tone: "energetic",
        instructions:
          "Skyline Homes has 2 and 3 BHK apartments in Baner, Pune, priced from eighty-five lakh rupees. Possession December 2027. Qualify on budget, preferred configuration, timeline and whether they need a home loan. Offer a weekend site visit.",
        qualification_criteria: "Budget of at least seventy-five lakh rupees and planning to buy within 12 months.",
        goals: ["Qualify budget, configuration and timeline", "Book a site visit for qualified buyers"],
      }),
  },
  {
    id: "support",
    label: "Customer support",
    business: "QuickCart",
    blurb: "Tracks orders, explains policies and resolves issues.",
    config: (language) =>
      parseAgentConfig({
        ...common,
        persona_name: "Kavya",
        company_name: "QuickCart",
        use_case: "support",
        primary_language: language,
        voice: "kavya",
        tone: "calm",
        instructions:
          "Demo orders: any order ID the caller gives is 'out for delivery, arriving today by 7 PM'. Returns are accepted within 7 days of delivery; refunds reach the original payment method in 5 to 7 working days. Never ask for card details or OTPs.",
        goals: ["Identify the order", "Resolve the question", "Offer further help"],
      }),
  },
  {
    id: "recruitment",
    label: "Recruitment screening",
    business: "TalentBridge Staffing",
    blurb: "Screens candidates and schedules interviews.",
    config: (language) =>
      parseAgentConfig({
        ...common,
        persona_name: "Simran",
        company_name: "TalentBridge Staffing",
        use_case: "recruitment",
        primary_language: language,
        voice: "simran",
        tone: "professional",
        instructions:
          "Role: Customer Support Executive, Bengaluru, Hindi and English required, salary three to four lakh rupees per year. Ask about current location, years of experience, notice period and expected salary. Offer an interview slot on Thursday at 11 AM or 3 PM.",
        qualification_criteria: "At least 1 year of customer-facing experience, notice period 30 days or less, comfortable in Hindi and English.",
        goals: ["Screen experience, notice period and salary expectations", "Schedule an interview"],
      }),
  },
  {
    id: "followup",
    label: "Follow-up & callback",
    business: "Brightpath Academy",
    blurb: "Follows up on enquiries and schedules callbacks.",
    config: (language) =>
      parseAgentConfig({
        ...common,
        persona_name: "Dev",
        company_name: "Brightpath Academy",
        use_case: "followup",
        primary_language: language,
        voice: "dev",
        tone: "warm",
        instructions:
          "The caller enquired about the JEE weekend batch. Fees are forty-five thousand rupees per year, payable in three instalments. New batch starts on the first Saturday of next month. If they are busy, offer to call back at a time they choose.",
        goals: ["Answer questions about the batch", "Book a counselling call or schedule a callback"],
      }),
  },
];

export function getDemoScenario(id: string) {
  return DEMO_SCENARIOS.find((s) => s.id === id);
}

/** Tool behaviour for demo agents: synthetic confirmations only. */
export function demoToolResult(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "book_appointment":
      return `Booked (demo) for ${String(input.when_iso ?? "the requested time")}. Reference DEMO-${Math.floor(1000 + Math.random() * 9000)}.`;
    case "schedule_callback":
      return `Callback scheduled (demo) for ${String(input.when_iso ?? "the requested time")}.`;
    case "save_caller_details":
      return "Details noted for this demo (not stored).";
    case "mark_qualified":
    case "mark_disqualified":
      return "Recorded.";
    case "add_to_dnc":
      return "Noted. This demo does not call anyone.";
    case "end_call":
      return "Ending the demo call.";
    default:
      return "Done.";
  }
}
