import type { RPCPayload, RPCResponse } from '@/common/rpc/types'
import { RpcException } from '@/common/rpc/types'

type ChromeSender = <TInput, TOutput>(
  payload: RPCPayload<TInput>
) => Promise<RPCResponse<TOutput>>

export const chromeSender: ChromeSender = async <TInput, TOutput>(
  payload: RPCPayload<TInput>
) => {
  const res = (await chrome.runtime.sendMessage(
    payload
  )) as RPCResponse<TOutput>

  return res
}

type TabSender = <TInput, TOutput>(
  payload: RPCPayload<TInput>,
  tabInfoParam?: chrome.tabs.QueryInfo,
  getTab?: (tabs: chrome.tabs.Tab[]) => chrome.tabs.Tab
) => Promise<RPCResponse<TOutput>>

export const tabSender: TabSender = async <TInput, TOutput>(
  payload: RPCPayload<TInput>,
  tabInfoParam?: chrome.tabs.QueryInfo,
  getTab?: (tabs: chrome.tabs.Tab[]) => chrome.tabs.Tab
) => {
  const tabInfo = tabInfoParam ?? { active: true, currentWindow: true }

  const tabs = await chrome.tabs.query(tabInfo)

  const tab = getTab ? getTab(tabs) : tabs[0]

  if (!tab) {
    throw new RpcException('No matching tab found')
  }

  if (tab.id === undefined) {
    throw new RpcException('Tab has no ID')
  }

  try {
    return (await chrome.tabs.sendMessage(
      tab.id,
      payload
    )) as RPCResponse<TOutput>
  } catch (e) {
    if (e instanceof Error) {
      throw new RpcException(e.message)
    }
    throw new RpcException('Unknown error occurred when sending message to tab')
  }
}
