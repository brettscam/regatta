import { JACKETS, myAvatar, onMyAvatar } from '../boat/avatar';
import { account as askAccount, onWeb, type Account } from '../net/platform';
import { figurePreview } from './figurePreview';
import { PROFILE_CHANGED, savedSkipper } from './profile';

/**
 * The account circle, on the website only: a small round badge that is always there. Signed in, it is the face of
 * the player's own figure. Signed out, it is an outline that says "Sign in". Either way it opens the Profile tab,
 * where the sign-in form and Sign out are.
 *
 * While sailing it sits in the bottom left corner, with the roadmap link moved along to make room, and hides with the
 * instruments (H). On the home screen and the way in, where that corner is taken, it is in the top right.
 */
export function mountAccountBadge(open: () => void): void {
  if (!onWeb()) return;
  const el = document.createElement('button');
  el.type = 'button';
  el.id = 'account';
  el.className = 'hud account';
  el.addEventListener('click', open);
  document.body.appendChild(el);
  let account: Account | null = null;

  const render = (): void => {
    const email = account?.email() ?? null;
    el.classList.toggle('in', !!email);
    if (!email) {
      el.title = 'Sign in to keep your logbook, vote and send feedback';
      el.textContent = 'Sign in';
    } else {
      el.title = `Signed in as ${email}. Your profile`;
      el.setAttribute('aria-label', 'Your profile');
      const face = figurePreview()?.portrait(myAvatar(), 96, 1, 0.3);
      if (face) el.innerHTML = `<img src="${face}" alt="">`;
      else {
        // No second 3D view to draw a face with: an initial on the jacket colour.
        const initial = (savedSkipper() || email).trim().charAt(0).toUpperCase();
        el.textContent = initial;
        el.style.background = `#${JACKETS[myAvatar().jacket].hex.toString(16).padStart(6, '0')}`;
      }
    }
    // The roadmap link moves along by the badge's width.
    document.body.style.setProperty('--account-w', `${el.offsetWidth + 8}px`);
    document.body.classList.add('has-account');
  };

  render();
  onMyAvatar(render);
  window.addEventListener(PROFILE_CHANGED, render);
  void askAccount().then((a) => {
    account = a;
    a?.onChange(render);
    render();
  }).catch(() => {});
}
