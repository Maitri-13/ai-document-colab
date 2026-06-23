'use client'
import { useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

let sharedSocket: Socket | null = null
let refCount = 0

function getSocket(): Socket {
  if (!sharedSocket || sharedSocket.disconnected) {
    sharedSocket = io(API_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    })
  }
  return sharedSocket
}

export function useSocket() {
  const [connected, setConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    refCount++
    const socket = getSocket()
    socketRef.current = socket

    const onConnect = () => setConnected(true)
    const onDisconnect = () => setConnected(false)

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    if (socket.connected) setConnected(true)

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      refCount--
      if (refCount === 0) {
        socket.disconnect()
        sharedSocket = null
      }
    }
  }, [])

  return { socket: socketRef.current ?? getSocket(), connected }
}
