const PRIVACY = {
  title: 'Privacy Policy',
  updated: 'Last updated 21 August 2026',
  blocks: [
    ['h2', 'The short version'],
    [
      'p',
      '7 Audio processes your audio inside your browser. Your files are not uploaded, not stored on our servers, and not seen by us. There is nothing for us to sell, share or lose.',
    ],
    ['h2', 'What happens to your audio'],
    [
      'p',
      'When you choose a file, the browser reads it into memory using the File API and decodes it locally. All processing — cutting, joining, conversion, pitch shifting, noise reduction and AI separation — runs in that same tab, on your own processor or graphics card. Results are created as Blobs in memory and saved directly to your device when you download them.',
    ],
    ['h2', 'What we store'],
    [
      'ul',
      [
        'Your theme and export preferences, in this browser only.',
        'A local record of jobs you have run, in this browser only, which you can clear from Settings.',
        'The AI separation model file, cached by your browser after first use, which you can remove from Settings.',
      ],
    ],
    ['h2', 'Network requests'],
    [
      'p',
      'The app itself is served over the network, as any website is. Fonts are loaded from Google Fonts. The AI separation model is downloaded once from its public host and then cached. None of these requests contain any part of your audio.',
    ],
    ['h2', 'Accounts'],
    [
      'p',
      'If you create an account, we hold the details you give us — name, email and plan — to operate it. In builds where no 7 Audio backend is connected, the sign-in forms cannot create an account at all and say so.',
    ],
    ['h2', 'Your rights'],
    [
      'p',
      'Because we do not receive your audio, there is no audio data of yours for us to disclose, correct or delete. For account data, contact us and we will action any access or deletion request.',
    ],
    ['h2', 'Contact'],
    ['p', 'Questions about this policy can go to privacy@7audio.app.'],
  ],
};

const TERMS = {
  title: 'Terms of Service',
  updated: 'Last updated 21 August 2026',
  blocks: [
    ['h2', 'Using 7 Audio'],
    [
      'p',
      '7 Audio provides browser-based audio processing tools. You may use them for personal and commercial work. You are responsible for having the rights to any audio you process.',
    ],
    ['h2', 'Copyright'],
    [
      'p',
      'Separating, editing or converting a recording does not grant you rights to it. Removing vocals from a commercial song creates a derivative work, and distributing it generally requires permission from the rights holders. Practising, studying and private use are usually fine; publishing is usually not. If you are unsure, check before you release.',
    ],
    ['h2', 'What we provide'],
    [
      'p',
      'The tools are supplied as they are. Audio processing is imperfect by nature — separation models leave artefacts, and lossy encoding discards information. We do not warrant a specific quality of result, and we recommend keeping your original files.',
    ],
    ['h2', 'Limits'],
    [
      'ul',
      [
        'Files up to 500 MB each. The practical limit is your own device memory.',
        'Availability of AI features depends on your browser supporting WebAssembly.',
        'Export is limited to formats a browser can encode: WAV and MP3.',
      ],
    ],
    ['h2', 'Plans and payment'],
    [
      'p',
      'Paid plans cover server-side processing and account features. Everyday use of the tools remains free. Plans can be cancelled at any time and continue until the end of the paid period.',
    ],
    ['h2', 'Changes'],
    ['p', 'We may update these terms. Material changes will be announced in the app before they take effect.'],
    ['h2', 'Contact'],
    ['p', 'Reach us at legal@7audio.app.'],
  ],
};

export default function Legal({ kind }: { kind: 'privacy' | 'terms' }) {
  const doc = kind === 'privacy' ? PRIVACY : TERMS;

  return (
    <article className="container section" style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 'clamp(27px, 5vw, 38px)' }}>{doc.title}</h1>
      <p className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 12 }}>
        {doc.updated}
      </p>
      <hr className="divider" style={{ margin: '26px 0' }} />

      <div className="prose">
        {doc.blocks.map((block, index) => {
          const [type, content] = block as [string, string | string[]];
          if (type === 'h2') return <h2 key={index}>{content as string}</h2>;
          if (type === 'ul')
            return (
              <ul key={index}>
                {(content as string[]).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            );
          return <p key={index}>{content as string}</p>;
        })}
      </div>
    </article>
  );
}
