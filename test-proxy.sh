#!/bin/bash
set -e

# Configuration
ROUTER_URL="http://localhost:6100/graphql"
MAX_RETRIES=10
RETRY_DELAY=2

echo "🧪 Starting GraphQL Router Proxy Test"

# 1. Wait for Router to be available
echo "⏳ Waiting for graphql-router to be available at $ROUTER_URL..."
for i in $(seq 1 $MAX_RETRIES); do
  # Check if router responds to a basic introspection query (even if it's disabled, the server is up)
  # or better yet, just wait for a 200/400 response from the endpoint.
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d '{"query":"{ __typename }"}' "$ROUTER_URL" || true)
  
  if [ "$STATUS" -eq 200 ] || [ "$STATUS" -eq 400 ] || [ "$STATUS" -eq 500 ]; then
    echo "✅ Router is reachable (HTTP $STATUS)"
    break
  fi
  
  if [ $i -eq $MAX_RETRIES ]; then
    echo "❌ Router is not reachable after $MAX_RETRIES attempts. Is it running?"
    echo "💡 You can start the stack using 'start-stack.sh' in the project root."
    exit 1
  fi
  
  echo "  ...retry $i/$MAX_RETRIES"
  sleep $RETRY_DELAY
done

# 2. Test Proxying to user-cycle
echo "🔄 Testing proxy to user-cycle service..."
# We query 'registrationNonce' since it is an unauthenticated query in user-cycle
QUERY='{"query": "query { registrationNonce { nonce } }"}'

RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" -d "$QUERY" "$ROUTER_URL")

# Check if response contains "data" and "registrationNonce"
if echo "$RESPONSE" | grep -q "registrationNonce"; then
  echo "✅ Proxy test passed! Response:"
  echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
  exit 0
else
  echo "❌ Proxy test failed! Response did not contain expected data."
  echo "Full response:"
  echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
  exit 1
fi
