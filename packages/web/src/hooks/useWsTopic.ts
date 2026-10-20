// P-223: React binding for the WsClient singleton. useWsTopic isolates
// re-renders — only this topic's events flow into the component.
import { useEffect, useRef, useState } from 'react';
import { wsClient, type WsStatus } from '../lib/ws.js';

export interface UseWsTopicResult<T> {
  events: T[];
  last: T | undefined;
  status: WsStatus;
  send: (msg: T) => void;
}

export function useWsTopic<T>(topic: string): UseWsTopicResult<T> {
  const [events, setEvents] = useState<T[]>([]);
  const [status, setStatus] = useState<WsStatus>(wsClient.status);
  const topicRef = useRef(topic);
  topicRef.current = topic;

  useEffect(() => {
    setEvents([]);
    const off = wsClient.subscribe<T>(topic, payload => {
      setEvents(prev => [...prev.slice(-499), payload]);
    });
    const offStatus = wsClient.onStatus(setStatus);
    return () => {
      off();
      offStatus();
    };
  }, [topic]);

  return {
    events,
    last: events.at(-1),
    status,
    send: (msg: T) => wsClient.publish(topicRef.current, msg),
  };
}
