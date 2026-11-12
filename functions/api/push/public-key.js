import { json } from '../../_lib.js';
export const onRequestGet = ({ env }) => json({ key: env.VAPID_PUBLIC_KEY || null });
