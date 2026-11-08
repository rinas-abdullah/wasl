Optional: drop extra root CA certificates (`*.crt`, PEM) here when building behind a TLS-intercepting
corporate proxy. They are used only during image builds (npm / pip downloads). The folder is empty by
default and `*.crt` files are git-ignored.
