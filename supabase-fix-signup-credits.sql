-- FundFinder AI — Fix: Give 20 free credits on signup
-- Run this in Supabase Dashboard → SQL Editor

-- Update the trigger to give 20 free credits instead of 0
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Create empty profile
  INSERT INTO public.user_profiles (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  -- Create wallet with 20 FREE credits on signup
  INSERT INTO public.wallets (user_id, balance_credits, total_credits_purchased)
  VALUES (NEW.id, 20, 0)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Also top up any existing users who have 0 credits (backfill)
UPDATE public.wallets 
SET balance_credits = 20 
WHERE balance_credits = 0 AND total_credits_purchased = 0;

-- Verify
SELECT COUNT(*) as users_with_free_credits FROM public.wallets WHERE balance_credits >= 20;
