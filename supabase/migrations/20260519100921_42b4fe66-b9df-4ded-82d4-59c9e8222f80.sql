CREATE POLICY "Admins can update all payment methods"
  ON public.user_payment_methods FOR UPDATE
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete all payment methods"
  ON public.user_payment_methods FOR DELETE
  USING (has_role(auth.uid(), 'admin'::app_role));