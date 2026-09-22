import type { ReactNode } from 'react';
import { safeCommands } from '@internal/tauri-api';
import { Button, Card, TextInput } from '@internal/ui';
import { useState } from 'react';

/**
 * The smallest possible round trip to Rust: send a string, render what comes
 * back. Everything else in the app follows this shape.
 */
export function GreetCard(): ReactNode {
  const [name, setName] = useState('Tauri');
  const [greeting, setGreeting] = useState('');
  const [error, setError] = useState('');
  const [isPending, setIsPending] = useState(false);

  const greet = async (): Promise<void> => {
    setIsPending(true);
    const result = await safeCommands.greet(name);
    setIsPending(false);

    if (result.ok) {
      setGreeting(result.value);
      setError('');
    } else {
      setGreeting('');
      setError(result.error);
    }
  };

  return (
    <Card
      title="Call a Rust command"
      description="greet(name) runs in src-tauri/src/commands.rs and returns a String."
    >
      <form
        className="flex items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void greet();
        }}
      >
        <TextInput
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="flex-1"
        />
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Calling…' : 'Greet'}
        </Button>
      </form>

      {greeting !== '' && (
        <p className="mt-4 rounded-md bg-muted px-3 py-2 text-sm">{greeting}</p>
      )}

      {error !== '' && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
    </Card>
  );
}
