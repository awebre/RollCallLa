import * as agendaFixtures from "./agenda";

export type FixtureOption = {
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
};

export type FeatureDefinition = {
  label: string;
  options: Record<string, FixtureOption>;
};

/** Registry of all debuggable features. Add new features here. */
export const DEBUG_FEATURES: Record<string, FeatureDefinition> = {
  agenda: {
    label: "Chamber Agenda",
    options: {
      allFuture:   { label: "All future (pre-session)",      data: agendaFixtures.allFuture },
      midSession:  { label: "Mid-session (current item)",    data: agendaFixtures.midSession },
      lateSession: { label: "Late session (mostly done)",    data: agendaFixtures.lateSession },
      done:        { label: "Done (all past)",               data: agendaFixtures.done },
      noAgenda:    { label: "No agenda (not in session)",    data: agendaFixtures.noAgenda },
      error:       { label: "Error (upstream failed)",       data: agendaFixtures.errorState },
    },
  },
};
