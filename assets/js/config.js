// Connection details for the Mokify database (Supabase).
// Both values are safe to commit: the key is the public "anon" / "publishable"
// key, and what it may do is limited by the row-level-security rules in
// supabase/schema.sql (it can only add registrations, never read them).
// Find them in Supabase: Project Settings -> API.
window.MOKIFY_CONFIG = {
  supabaseUrl: 'https://wswryravelakztdkiysq.supabase.co',
  supabaseKey: 'sb_publishable_GBV4VAh97BILvQ_ZNDoTyw_2S_x_xUu',
};
