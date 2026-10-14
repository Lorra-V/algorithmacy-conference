import { PortalSession } from '../../components/portal/session';
import PortalShell from '../../components/portal/PortalShell';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Algorithmacy Studio',
  robots: { index: false, follow: false },
};

export default function PortalLayout({ children }) {
  return (
    <PortalSession>
      <PortalShell>{children}</PortalShell>
    </PortalSession>
  );
}
