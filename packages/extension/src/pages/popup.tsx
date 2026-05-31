import { render } from 'preact';
import { APP_NAME } from '@moviefinder/shared';

function Popup() {
  return (
    <div>
      <h1>{APP_NAME}</h1>
      <p>
        Open Netflix and use the side panel to get conversational recommendations. Settings and
        onboarding will live here.
      </p>
    </div>
  );
}

const root = document.getElementById('app');
if (root) render(<Popup />, root);
