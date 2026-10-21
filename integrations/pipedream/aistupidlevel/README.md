# AI Stupid Level for Pipedream

Components for the [AI Stupid Level](https://aistupidlevel.info/router) Smart Router, in the layout of the
[Pipedream registry](https://github.com/PipedreamHQ/pipedream/tree/master/components): `Send Prompt`,
`Preview Route` and `Get Usage`. Each call can run in sandbox mode (real routing, mock answer, nothing spent).

Pipedream creates an app's directory and its authentication before community components can be added, so these
go into `components/aistupidlevel` in a pull request once the app exists. The app reads the router key from
`$auth.api_key`.

MIT licence.
