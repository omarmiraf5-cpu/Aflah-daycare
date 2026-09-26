// Aflah Daycare portals: connection settings.
//
// Leave these empty to run the portals in DEMO MODE: sample data that is saved
// only in the browser on this device. To go live, create a free Supabase
// project, run supabase/schema.sql in it, and paste the two values from
// Supabase → Project Settings → API below (see README.md).
export const CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: "",

  // How money and dates are shown
  locale: "en-CA",
  currency: "CAD",
};
