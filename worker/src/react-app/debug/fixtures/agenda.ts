import type { AgendaResult } from "../../components/ChamberAgenda";

const BASE = {
  chamber: "H" as const,
  date: "May 20, 2026",
  time: "1:00 PM",
  location: "House Chamber",
  fetched_at: new Date().toISOString(),
  ok: true as const,
};

// 30 realistic bills drawn from the kinds of items a Louisiana floor session has
const BILLS = [
  { bill_number: "HR 73",   author: "DUPLESSIS",   subject: "DOMESTIC ABUSE: Directs the Louisiana State Law Institute to study abuse-related civil remedies" },
  { bill_number: "HR 118",  author: "FONTENOT",    subject: "TAX/INCOME-CREDIT: Creates a legislative subcommittee to study tax credit reform" },
  { bill_number: "HR 144",  author: "HILFERTY",    subject: "ENERGY: Requests that the Board of Regents provide for academic programs in energy transition" },
  { bill_number: "HR 196",  author: "BOURRIAQUE",  subject: "INSURANCE/PROPERTY: Establishes a special study committee on homeowner insurance availability" },
  { bill_number: "HR 237",  author: "MCCORMICK",   subject: "CENSUS: Memorializes Congress to enact a provision in the next census for citizenship status" },
  { bill_number: "HB 101",  author: "SCHLEGEL",    subject: "CONTRACTS: Provides relative to material harmful to minors (EGF SEE FISC NOTE SG EX)" },
  { bill_number: "HB 134",  author: "BEAULLIEU",   subject: "ETHICS/DUAL OFFICEHOLDG: Provides for exceptions to the dual officeholding laws for volunteer firefighters" },
  { bill_number: "HB 255",  author: "WYBLE",       subject: "PROPERTY/EXPROPRIATION: Authorizes certain parishes and municipalities to expropriate blighted property" },
  { bill_number: "HB 263",  author: "CHASSIS",     subject: "TOBACCO/TOBACCO PRODUCTS: Prohibits the sale of vapor products near schools" },
  { bill_number: "HB 302",  author: "EDMONSTON",   subject: "DOMESTIC ABUSE: Provides relative to court costs and fees in domestic abuse cases" },
  { bill_number: "HB 341",  author: "FREIBERG",    subject: "LAW ENFORCEMENT: Provides for rights of law enforcement officers while under investigation" },
  { bill_number: "HB 378",  author: "FONTENOT",    subject: "ELECTIONS/BOND & TAX: (Constitutional Amendment) Provides for eligible election dates for bond and tax elections" },
  { bill_number: "HB 393",  author: "GLORIOSO",    subject: "INSURANCE: Provides relative to penalties calculated on the amount found to be due from the insurer" },
  { bill_number: "HB 458",  author: "KNOX",        subject: "CORRECTIONS/PRISONERS: Provides relative to inmates who participate in work release programs" },
  { bill_number: "HB 509",  author: "WRIGHT",      subject: "FUNDS/FUNDING: (Constitutional Amendment) Authorizes the investment of state funds in digital assets and precious metals" },
  { bill_number: "HB 577",  author: "BEAULLIEU",   subject: "WORKERS COMPENSATION: Provides relative to experience modifiers and subrogation in workers' compensation cases" },
  { bill_number: "HB 603",  author: "JACKSON",     subject: "TAX/TAX REBATES: Authorizes a rebate of state sales taxes paid by businesses on lodging and meals for disaster work" },
  { bill_number: "HB 625",  author: "JORDAN",      subject: "INSURANCE: Requires peer-to-peer car sharing programs to maintain physical damage coverage during car sharing period" },
  { bill_number: "HB 733",  author: "PHELPS",      subject: "MTR VEHICLE/OFFICE: Provides relative to reinstatement fees for certain motor vehicle violations" },
  { bill_number: "HB 752",  author: "GREEN",       subject: "LEGISLATIVE SESSIONS: (Constitutional Amendment) Provides for timing and duration of regular sessions by joint rule" },
  { bill_number: "SB 29",   author: "MCMATH",      subject: "PUBLIC HEALTH: Requires coroners to report certain information regarding sudden child deaths. (8/1/26)" },
  { bill_number: "SB 42",   author: "EDMONDS",     subject: "CRIME/PUNISHMENT: Prohibits using artificial intelligence to create child sexual abuse materials. (8/1/26)" },
  { bill_number: "SB 43",   author: "MCMATH",      subject: "HEALTH SERVICES: Provides relative to psychedelic-assisted therapy. (8/1/26) (REF INCREASE GF EX See Note)" },
  { bill_number: "SB 77",   author: "SEABAUGH",    subject: "SCHOOLS: Provides for a five-day school week for public schools with exceptions. (gov sig)" },
  { bill_number: "SB 82",   author: "MIZELL",      subject: "WORKERS' COMPENSATION: Repeals provisions relative to the Workers' Compensation Advisory Council. (8/1/26)" },
  { bill_number: "SB 89",   author: "HENSGENS",    subject: "NATURAL RESOURCES DEPT: Provides for the Department of Conservation and Energy. (8/1/26)" },
  { bill_number: "HCR 65",  author: "BUTLER",      subject: "CONGRESS: Memorializes Congress to reclassify crawfish industry duties as agricultural labor for H-2A program" },
  { bill_number: "HCR 71",  author: "CHASSION",    subject: "DRUGS/CONTROLLED: Requests the Louisiana Dept. of Health to review pregnancy-related emergency medications guidance" },
  { bill_number: "HCR 98",  author: "CARPENTER",   subject: "SNAP/FOOD STAMPS: Modifies the use of SNAP benefits to include food delivery costs" },
  { bill_number: "SCR 12",  author: "DUPLESSIS",   subject: "ELECTIONS: Urges and requests the Secretary of State to study ranked-choice voting implementation" },
];

export const allFuture: AgendaResult = {
  ...BASE,
  items: BILLS.map((b) => ({ ...b, status: "future" })),
};

// 8 past, bill 8 is current, rest future
export const midSession: AgendaResult = {
  ...BASE,
  items: BILLS.map((b, i) => ({
    ...b,
    status: i < 8 ? "past" : i === 8 ? "current" : "future",
  })),
};

// 22 past, bill 22 is current, rest future
export const lateSession: AgendaResult = {
  ...BASE,
  items: BILLS.map((b, i) => ({
    ...b,
    status: i < 22 ? "past" : i === 22 ? "current" : "future",
  })),
};

export const done: AgendaResult = {
  ...BASE,
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
  items: [],
  fetched_at: new Date().toISOString(),
  ok: false,
  error: "upstream 503",
};
