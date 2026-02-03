import { createRootRoute, Outlet } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/router-devtools';
import * as stylex from '@stylexjs/stylex';
import { dosColors } from '@styles/tokens.stylex';

const styles = stylex.create({
  root: {
    width: '100%',
    height: '100%',
    backgroundColor: dosColors.background,
    color: dosColors.white,
    display: 'flex',
    flexDirection: 'column',
  },
});

export const Route = createRootRoute({
  component: () => (
    <div {...stylex.props(styles.root)}>
      <Outlet />
      {import.meta.env.DEV && <TanStackRouterDevtools />}
    </div>
  ),
});
