import type { AgendaResult, AgendaCategory } from "../../components/ChamberAgenda";

const BASE = {
  chamber: "H" as const,
  date: "May 20, 2026",
  time: "1:00 PM",
  location: "House Chamber",
  in_progress: false,
  adjourned: false,
  fetched_at: new Date().toISOString(),
  ok: true as const,
};

// 30 realistic bills with realistic category distribution
const BILLS: Array<{ bill_number: string; author: string; subject: string; category: AgendaCategory }> = [
  { bill_number: "HR73",   author: "DUPLESSIS",   category: "second_reading", subject: "DOMESTIC ABUSE: Directs the Louisiana State Law Institute to study abuse-related civil remedies" },
  { bill_number: "HR118",  author: "FONTENOT",    category: "second_reading", subject: "TAX/INCOME-CREDIT: Creates a legislative subcommittee to study tax credit reform" },
  { bill_number: "HR144",  author: "HILFERTY",    category: "second_reading", subject: "ENERGY: Requests that the Board of Regents provide for academic programs in energy transition" },
  { bill_number: "HR196",  author: "BOURRIAQUE",  category: "second_reading", subject: "INSURANCE/PROPERTY: Establishes a special study committee on homeowner insurance availability" },
  { bill_number: "HR237",  author: "MCCORMICK",   category: "second_reading", subject: "CENSUS: Memorializes Congress to enact a provision in the next census for citizenship status" },
  { bill_number: "HB101",  author: "SCHLEGEL",    category: "final_passage",  subject: "CONTRACTS: Provides relative to material harmful to minors (EGF SEE FISC NOTE SG EX)" },
  { bill_number: "HB134",  author: "BEAULLIEU",   category: "final_passage",  subject: "ETHICS/DUAL OFFICEHOLDG: Provides for exceptions to the dual officeholding laws for volunteer firefighters" },
  { bill_number: "HB255",  author: "WYBLE",       category: "final_passage",  subject: "PROPERTY/EXPROPRIATION: Authorizes certain parishes and municipalities to expropriate blighted property" },
  { bill_number: "HB263",  author: "CHASSIS",     category: "final_passage",  subject: "TOBACCO/TOBACCO PRODUCTS: Prohibits the sale of vapor products near schools" },
  { bill_number: "HB302",  author: "EDMONSTON",   category: "final_passage",  subject: "DOMESTIC ABUSE: Provides relative to court costs and fees in domestic abuse cases" },
  { bill_number: "HB341",  author: "FREIBERG",    category: "final_passage",  subject: "LAW ENFORCEMENT: Provides for rights of law enforcement officers while under investigation" },
  { bill_number: "HB378",  author: "FONTENOT",    category: "final_passage",  subject: "ELECTIONS/BOND & TAX: (Constitutional Amendment) Provides for eligible election dates for bond and tax elections" },
  { bill_number: "HB393",  author: "GLORIOSO",    category: "concurrence",    subject: "INSURANCE: Provides relative to penalties calculated on the amount found to be due from the insurer" },
  { bill_number: "HB458",  author: "KNOX",        category: "concurrence",    subject: "CORRECTIONS/PRISONERS: Provides relative to inmates who participate in work release programs" },
  { bill_number: "HB509",  author: "WRIGHT",      category: "final_passage",  subject: "FUNDS/FUNDING: (Constitutional Amendment) Authorizes the investment of state funds in digital assets and precious metals" },
  { bill_number: "HB577",  author: "BEAULLIEU",   category: "final_passage",  subject: "WORKERS COMPENSATION: Provides relative to experience modifiers and subrogation in workers' compensation cases" },
  { bill_number: "HB603",  author: "JACKSON",     category: "final_passage",  subject: "TAX/TAX REBATES: Authorizes a rebate of state sales taxes paid by businesses on lodging and meals for disaster work" },
  { bill_number: "HB625",  author: "JORDAN",      category: "final_passage",  subject: "INSURANCE: Requires peer-to-peer car sharing programs to maintain physical damage coverage during car sharing period" },
  { bill_number: "HB733",  author: "PHELPS",      category: "second_reading", subject: "MTR VEHICLE/OFFICE: Provides relative to reinstatement fees for certain motor vehicle violations" },
  { bill_number: "HB752",  author: "GREEN",       category: "second_reading", subject: "LEGISLATIVE SESSIONS: (Constitutional Amendment) Provides for timing and duration of regular sessions by joint rule" },
  { bill_number: "SB29",   author: "MCMATH",      category: "final_passage",  subject: "PUBLIC HEALTH: Requires coroners to report certain information regarding sudden child deaths. (8/1/26)" },
  { bill_number: "SB42",   author: "EDMONDS",     category: "final_passage",  subject: "CRIME/PUNISHMENT: Prohibits using artificial intelligence to create child sexual abuse materials. (8/1/26)" },
  { bill_number: "SB43",   author: "MCMATH",      category: "final_passage",  subject: "HEALTH SERVICES: Provides relative to psychedelic-assisted therapy. (8/1/26) (REF INCREASE GF EX See Note)" },
  { bill_number: "SB77",   author: "SEABAUGH",    category: "final_passage",  subject: "SCHOOLS: Provides for a five-day school week for public schools with exceptions. (gov sig)" },
  { bill_number: "SB82",   author: "MIZELL",      category: "concurrence",    subject: "WORKERS' COMPENSATION: Repeals provisions relative to the Workers' Compensation Advisory Council. (8/1/26)" },
  { bill_number: "SB89",   author: "HENSGENS",    category: "second_reading", subject: "NATURAL RESOURCES DEPT: Provides for the Department of Conservation and Energy. (8/1/26)" },
  { bill_number: "HCR65",  author: "BUTLER",      category: "second_reading", subject: "CONGRESS: Memorializes Congress to reclassify crawfish industry duties as agricultural labor for H-2A program" },
  { bill_number: "HCR71",  author: "CHASSION",    category: "second_reading", subject: "DRUGS/CONTROLLED: Requests the Louisiana Dept. of Health to review pregnancy-related emergency medications guidance" },
  { bill_number: "HCR98",  author: "CARPENTER",   category: "second_reading", subject: "SNAP/FOOD STAMPS: Modifies the use of SNAP benefits to include food delivery costs" },
  { bill_number: "SCR12",  author: "DUPLESSIS",   category: "second_reading", subject: "ELECTIONS: Urges and requests the Secretary of State to study ranked-choice voting implementation" },
];

export const allFuture: AgendaResult = {
  ...BASE,
  items: BILLS.map((b) => ({ ...b, status: "future" })),
};

// 8 past, bill 8 is current, rest future
export const midSession: AgendaResult = {
  ...BASE,
  in_progress: true,
  items: BILLS.map((b, i) => ({
    ...b,
    status: i < 8 ? "past" : i === 8 ? "current" : "future",
  })),
};

// 22 past, bill 22 is current, rest future
export const lateSession: AgendaResult = {
  ...BASE,
  in_progress: true,
  items: BILLS.map((b, i) => ({
    ...b,
    status: i < 22 ? "past" : i === 22 ? "current" : "future",
  })),
};

export const done: AgendaResult = {
  ...BASE,
  adjourned: true,
  items: BILLS.map((b) => ({ ...b, status: "past" })),
};

export const noAgenda: AgendaResult = {
  ...BASE,
  items: [],
};

export const errorState: AgendaResult = {
  chamber: "H",
  date: null,
  time: null,
  location: null,
  in_progress: false,
  adjourned: false,
  items: [],
  fetched_at: new Date().toISOString(),
  ok: false,
  error: "upstream 503",
};
