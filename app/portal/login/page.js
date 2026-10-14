'use client';

import { LoginForm } from '../../../components/portal/LoginForm';

export default function LoginPage() {
  return (
    <LoginForm
      title="Sign in to the Studio portal."
      lead="Use the email the invite went to. After the link, the portal asks for a code from an authenticator app. Clients book a call if they have no invite."
      showBookLink
    />
  );
}
