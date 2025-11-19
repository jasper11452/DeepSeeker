# DeepSeeker Test Document

This document demonstrates the structure-aware chunking capabilities of DeepSeeker.

## Database Connection Module

This section contains database connection utilities.

### Redis Connection

Here's how we connect to Redis:

```python
import redis
from typing import Optional

def connect_redis(host: str = "localhost", port: int = 6379) -> redis.Redis:
    """
    Establish a connection to Redis server.

    This function will never be split because DeepSeeker preserves
    code block integrity!
    """
    client = redis.Redis(
        host=host,
        port=port,
        db=0,
        decode_responses=True
    )

    try:
        client.ping()
        print(f"Connected to Redis at {host}:{port}")
        return client
    except redis.ConnectionError as e:
        print(f"Failed to connect: {e}")
        raise
```

### PostgreSQL Connection

And here's our PostgreSQL setup:

```python
import psycopg2
from contextlib import contextmanager

@contextmanager
def get_db_connection():
    """Context manager for database connections with retry logic."""
    conn = None
    retries = 3

    for attempt in range(retries):
        try:
            conn = psycopg2.connect(
                dbname="myapp",
                user="admin",
                password="secret",
                host="localhost"
            )
            yield conn
            conn.commit()
            break
        except psycopg2.OperationalError:
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt)
        finally:
            if conn:
                conn.close()
```

## API Endpoints

This section covers our REST API implementation.

### User Authentication

```typescript
interface AuthRequest {
  username: string;
  password: string;
}

interface AuthResponse {
  token: string;
  expiresAt: Date;
}

async function authenticate(req: AuthRequest): Promise<AuthResponse> {
  // Hash the password
  const hashedPassword = await bcrypt.hash(req.password, 10);

  // Verify credentials
  const user = await db.users.findOne({
    username: req.username,
    password: hashedPassword
  });

  if (!user) {
    throw new Error('Invalid credentials');
  }

  // Generate JWT
  const token = jwt.sign(
    { userId: user.id, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  return {
    token,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
  };
}
```

### Data Validation

We use Zod for runtime type checking:

```typescript
import { z } from 'zod';

const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  age: z.number().min(18).max(120),
  roles: z.array(z.enum(['admin', 'user', 'moderator']))
});

type User = z.infer<typeof UserSchema>;
```

## Algorithm Implementation

### Binary Search

```rust
fn binary_search<T: Ord>(arr: &[T], target: &T) -> Option<usize> {
    let mut left = 0;
    let mut right = arr.len();

    while left < right {
        let mid = left + (right - left) / 2;

        match arr[mid].cmp(target) {
            std::cmp::Ordering::Equal => return Some(mid),
            std::cmp::Ordering::Less => left = mid + 1,
            std::cmp::Ordering::Greater => right = mid,
        }
    }

    None
}
```

## Important Notes

When searching for "database retry logic", DeepSeeker will find the PostgreSQL connection
function even though the word "retry" appears only in comments. That's semantic search!

When searching for the exact UUID "550e8400-e29b-41d4-a716-446655440000", the BM25
search will find it instantly.

### Key Features

- **Header Context**: Every code block knows which H1 > H2 > H3 it belongs to
- **Code Integrity**: Functions never get split mid-definition
- **Metadata Tagging**: Language info preserved for syntax highlighting

## Conclusion

This is how DeepSeeker ensures you always get complete, contextual search results.
No more fragmented code snippets!
