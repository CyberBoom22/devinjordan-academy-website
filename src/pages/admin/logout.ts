/**
 * Sign out. POST only — a GET would let any page on the internet sign the
 * academy out by embedding an image pointing here.
 */

import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ locals, redirect }) => {
  await locals.supabase?.auth.signOut();
  return redirect('/admin/login', 303);
};

export const GET: APIRoute = ({ redirect }) => redirect('/admin/login', 303);
