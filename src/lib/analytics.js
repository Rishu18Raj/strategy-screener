import posthog from 'posthog-js'

export const track = {
  backtestRun: (props) => posthog.capture('backtest_run', props),
  configSaved: (props) => posthog.capture('config_saved', props),
  aiChatUsed: (props) => posthog.capture('ai_chat_used', props),
  signedUp: (props) => posthog.capture('signup', props),
  loggedIn: (props) => posthog.capture('login', props),
}