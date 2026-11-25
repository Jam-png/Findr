/**
 * One-time migration for existing Findr users.
 * Run locally with SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
 * and PASSWORD_RESET_REDIRECT_URL set in the environment.
 * Never deploy this script as a public API endpoint.
 */
require('dotenv').config();
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const db = require('../backend/db');

const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const redirectTo = process.env.PASSWORD_RESET_REDIRECT_URL;

if (!supabaseUrl || !anonKey || !redirectTo) {
  throw new Error('Set SUPABASE_URL, SUPABASE_ANON_KEY, and PASSWORD_RESET_REDIRECT_URL before running the migration.');
}

const authClient = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

function temporaryPassword() {
  return `${crypto.randomBytes(36).toString('base64url')}Aa1!`;
}

async function pause(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  const { data: profiles, error } = await db.from('users')
    .select('id,email,full_name,username,auth_user_id')
    .is('auth_user_id', null)
    .order('id');
  if (error) throw error;

  console.log(`Found ${profiles.length} existing Findr account(s) to migrate.`);
  let migrated = 0;
  let failed = 0;

  for (const profile of profiles) {
    let authUserId = null;
    let linkedToProfile = false;
    try {
      const created = await db.auth.admin.createUser({
        email: profile.email,
        password: temporaryPassword(),
        email_confirm: true,
        user_metadata: { full_name: profile.full_name, username: profile.username }
      });
      if (created.error) throw created.error;
      authUserId = created.data.user.id;

      const linked = await db.from('users')
        .update({ auth_user_id: authUserId })
        .eq('id', profile.id)
        .is('auth_user_id', null)
        .select('id')
        .maybeSingle();
      if (linked.error) throw linked.error;
      if (!linked.data) throw new Error('Profile was already linked by another process.');
      linkedToProfile = true;

      const reset = await authClient.auth.resetPasswordForEmail(profile.email, { redirectTo });
      if (reset.error) throw reset.error;

      migrated++;
      console.log(`Migrated user ID ${profile.id} (${profile.email}); password setup email requested.`);
      // Avoid sending recovery requests too rapidly through Supabase's default email service.
      await pause(1500);
    } catch (err) {
      failed++;
      console.error(`Could not migrate user ID ${profile.id} (${profile.email}): ${err.message}`);
      // If email delivery failed, undo the link and remove the temporary Auth identity.
      // The legacy bcrypt login remains available until migration succeeds.
      if (authUserId) {
        if (linkedToProfile) {
          await db.from('users').update({ auth_user_id: null })
            .eq('id', profile.id).eq('auth_user_id', authUserId);
        }
        await db.auth.admin.deleteUser(authUserId).catch(() => {});
      }
    }
  }

  console.log(`Migration finished. Migrated: ${migrated}. Failed: ${failed}.`);
  if (failed) process.exitCode = 1;
})().catch(err => {
  console.error('Migration stopped:', err);
  process.exitCode = 1;
});
