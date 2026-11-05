---
appliesTo: "*.go"
type: noul
---
Does this file violate the following rule?

# Ignored errors

A returned error that is discarded hides a failure. Assigning a call's error to
`_`, or calling a function that returns an error without handling it, throws away
the only signal that something went wrong:

```go
data, _ := os.ReadFile(path)
json.NewDecoder(r.Body).Decode(&req)
```

Report a violation when the file discards an error returned by a call.
