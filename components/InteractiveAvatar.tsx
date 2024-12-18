"use client";

import type { StartAvatarResponse } from "@heygen/streaming-avatar";
import StreamingAvatar, {
  AvatarQuality,
  StreamingEvents,
  TaskType,
  VoiceEmotion,
} from "@heygen/streaming-avatar";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";

import { useEffect, useRef, useState, useCallback } from "react";
import { useMemoizedFn, usePrevious } from "ahooks";
import { useUser, useAuth, useSession } from '@clerk/nextjs';


import { 
  startSession, 
  updateSessionActivity, 
  endSession,
  type SessionData 
} from '../lib/sessionManagement';
import { supabase, initializeWithClerkToken } from '../lib/supabaseClient';

import { createClerkSupabaseClient } from '../lib/supabaseClient';

import InteractiveAvatarTextInput from "./InteractiveAvatarTextInput";

import { AVATARS, STT_LANGUAGE_LIST, KNOWLEDGE_BASE_IDS } from "@/app/lib/constants";
import { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js'

interface Message {
  speaker: 'User' | 'Avatar';
  text: string;
  isComplete: boolean;
}


interface SessionData {
  clerk_id: string;
  knowledgebase_id: string;
  avatar_id: string;
  language: string;
  type: string;
}

export default function InteractiveAvatar() {
  const { user } = useUser();

  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [lastActivity, setLastActivity] = useState<number>(Date.now());
  const INACTIVITY_TIMEOUT = 300000; // 5 minutes in milliseconds

  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isLoadingRepeat, setIsLoadingRepeat] = useState(false);
  const [stream, setStream] = useState<MediaStream>();
  const [debug, setDebug] = useState<string>();
  const [knowledgeId, setKnowledgeId] = useState<string>("");
  const [avatarId, setAvatarId] = useState<string>("");
  const [language, setLanguage] = useState<string>('en');

  const [data, setData] = useState<StartAvatarResponse>();
  const [text, setText] = useState<string>("");
  const mediaStream = useRef<HTMLVideoElement>(null);
  const avatar = useRef<StreamingAvatar | null>(null);
  const [chatMode, setChatMode] = useState<"text_mode" | "voice_mode">("voice_mode");
  const [isUserTalking, setIsUserTalking] = useState(false);

  const [selectedKnowledgeBase, setSelectedKnowledgeBase] = useState('');
  const [knowledgeBaseDescription, setKnowledgeBaseDescription] = useState('');

  const [messages, setMessages] = useState<Message[]>([]);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const [isEndingSession, setIsEndingSession] = useState(false);
  const endSessionRef = useRef(false);

  const [sessionEnded, setSessionEnded] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

  // Force update function
  const [, updateState] = useState({});
  const forceUpdate = useCallback(() => updateState({}), []);

  const resetInactivityTimer = () => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
    inactivityTimerRef.current = setTimeout(handleInactivityTimeout, INACTIVITY_TIMEOUT);
    setLastActivity(Date.now());
    if (currentSessionId && supabase) {
      updateSessionActivity(supabase, currentSessionId);
    }
  };

  const handleInactivityTimeout = () => {
    if (currentSessionId) {
      handleEndSession();
    }
  };

const { getToken } = useAuth();
const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
const [isSupabaseInitialized, setIsSupabaseInitialized] = useState(false);
const { session, isLoaded, isSignedIn } = useSession();

useEffect(() => {
  initializeSupabase()
}, [])

async function initializeSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Supabase URL or Anon Key is missing')
    return
  }

  let supabaseClient

  if (user) {
    const token = await getToken({ template: 'supabase' })
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
  } else {
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey)
  }

  setSupabase(supabaseClient)
}

useEffect(() => {
  if (isSupabaseInitialized && user) {
    // Example of using the Supabase client
    async function fetchData() {
      const { data, error } = await supabase.from('sessions').select('*');
      if (error) {
        console.error('Error fetching data:', error);
      } else {
        console.log('Data fetched successfully:', data);
      }
    }
    fetchData();
  }
}, [isSupabaseInitialized, user, supabase]);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    resetInactivityTimer();
    return () => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
    };
  }, [currentSessionId]);

  useEffect(() => {
    if (currentSessionId) {
      resetInactivityTimer();
    }
  }, [messages]);

  async function fetchAccessToken(): Promise<string> {
    try {
      const response = await fetch("/api/get-access-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
  
      if (!response.ok) {
        const errorText = await response.text();
        console.error("Failed to fetch access token:", errorText);
        throw new Error(`Failed to fetch access token: ${errorText}`);
      }
  
      const token = await response.text();
      console.log("Access Token:", token.substring(0, 10) + '...');
      return token;
    } catch (error: any) {
      console.error("Error fetching access token:", error);
      throw error; // Propagate error instead of returning empty string
    }
  }
  
 // Modified handleStartSession function for InteractiveAvatar component
async function handleStartSession() {
  if (!supabase || !user) {
    console.error('Supabase client or user not initialized');
    return;
  }

  setIsLoadingSession(true);
  try {
    // 1. Fetch access token
    const newToken = await fetchAccessToken();
    if (!newToken) {
      throw new Error("No access token received. Cannot start avatar session.");
    }

    // 2. Initialize avatar
    avatar.current = new StreamingAvatar({ token: newToken });
    console.log("Avatar initialized successfully");
    
    // 3. Setup event listeners
    setupEventListeners();

    // 4. Start avatar
    const res = await avatar.current.createStartAvatar({
      quality: AvatarQuality.High,
      avatarName: avatarId,
      knowledgeId: selectedKnowledgeBase,
      voice: {
        rate: 1.5,
        emotion: VoiceEmotion.EXCITED,
      },
      language: language,
    });

    // 5. Create session in database
    const sessionData = {
      clerk_id: user.id,
      knowledgebase_id: selectedKnowledgeBase,
      avatar_id: avatarId,
      language: language,
      type: chatMode === 'voice_mode' ? 'Voice' : 'Text'
    };

    const sessionId = await startSession(supabase, sessionData);
    setCurrentSessionId(sessionId);

    // 6. Update UI state
    console.log("Avatar started successfully:", res);
    setData(res);
    await avatar.current.startVoiceChat();
    setChatMode("voice_mode");
    setDebug('Session started successfully');

  } catch (error: any) {
    console.error("Error in handleStartSession:", error);
    setDebug(`Error starting session: ${error.message}`);
    
    // Cleanup on error
    if (avatar.current) {
      try {
        await avatar.current.destroy();
        avatar.current = null;
      } catch (cleanupError) {
        console.error("Error cleaning up avatar:", cleanupError);
      }
    }
  } finally {
    setIsLoadingSession(false);
  }
}

const handleEndSession = useCallback(async () => {
  console.log('handleEndSession called. Current session ID:', currentSessionId);
  if (!supabase || !currentSessionId || endSessionRef.current) {
    console.log('No active session to end or already ending session. endSessionRef:', endSessionRef.current);
    return;
  }

  endSessionRef.current = true;
  setIsEndingSession(true);
  
  try {
    // Cleanup avatar
    if (avatar.current) {
      if (typeof avatar.current.destroy === 'function') {
        await avatar.current.destroy();
      }
      avatar.current.closeVoiceChat();
    }

    // Create transcript from messages
    const transcript = messages
      .filter(m => m.text !== '[Voice Input]')
      .map(m => `${m.speaker}: ${m.text}`)
      .join('\n');

    // End session in database
    await endSession(supabase, currentSessionId, transcript, user?.id);

    // Reset state
    setCurrentSessionId(null);
    setStream(undefined);
    setMessages([]);
    setData(undefined);
    setChatMode("text_mode");
    setIsUserTalking(false);
    setSessionEnded(true);
    
  } catch (error) {
    console.error('Error ending session:', error);
    setDebug(`Error ending session: ${error.message}`);
  } finally {
    setIsEndingSession(false);
    endSessionRef.current = false;
  }
}, [supabase, currentSessionId, messages, user?.id]);
  function setupEventListeners() {
    if (!avatar.current) return;
  
    const eventListeners = [
      { event: StreamingEvents.USER_TALKING_MESSAGE, handler: handleUserTalkingMessage },
      { event: StreamingEvents.USER_STOP, handler: handleUserStop },
      { event: StreamingEvents.AVATAR_TALKING_MESSAGE, handler: handleAvatarTalkingMessage },
      { event: StreamingEvents.AVATAR_STOP_TALKING, handler: handleAvatarStopTalking },
      { event: StreamingEvents.AVATAR_START_TALKING, handler: (e) => console.log("Avatar started talking", e) },
      { event: StreamingEvents.STREAM_DISCONNECTED, handler: () => { console.log("Stream disconnected"); handleEndSession(); } },
      { event: StreamingEvents.STREAM_READY, handler: (event) => { console.log("Stream ready:", event.detail); setStream(event.detail); } },
      { event: StreamingEvents.USER_START, handler: (event) => { console.log("User started talking:", event); setIsUserTalking(true); } },
    ];
  
    eventListeners.forEach(({ event, handler }) => {
      avatar.current.on(event, handler);
    });
  }
  
  function handleUserTalkingMessage(event: CustomEvent<{message: string}>) {
    console.log("User talking message:", event.detail);
    if (event.detail.message && event.detail.message !== '[Voice Input]') {
      updateMessages('User', event.detail.message, false);
    }
    resetInactivityTimer();
  }
  
  function handleUserStop() {
    console.log("User stopped talking");
    completeLastMessage('User');
  }
  
  function handleAvatarTalkingMessage(event: CustomEvent<{message: string}>) {
    console.log("Avatar talking message:", event.detail);
    updateMessages('Avatar', event.detail.message, false);
    resetInactivityTimer();
  }
  
  function handleAvatarStopTalking() {
    console.log("Avatar stopped talking");
    completeLastMessage('Avatar');
  }
  
  function updateMessages(speaker: string, text: string, isComplete: boolean) {
    setMessages(prevMessages => {
      const lastMessage = prevMessages[prevMessages.length - 1];
      if (lastMessage && lastMessage.speaker === speaker && !lastMessage.isComplete) {
        // Update the last message
        const updatedMessages = [...prevMessages];
        updatedMessages[updatedMessages.length - 1] = {
          ...lastMessage,
          text: lastMessage.text + text,
          isComplete
        };
        return updatedMessages;
      } else {
        // Add a new message
        return [...prevMessages, { speaker, text, isComplete }];
      }
    });
  }
  
  function completeLastMessage(speaker: 'User' | 'Avatar') {
    setMessages(prev => {
      const lastMessage = prev[prev.length - 1];
      if (lastMessage && lastMessage.speaker === speaker && !lastMessage.isComplete) {
        return [...prev.slice(0, -1), { ...lastMessage, isComplete: true }];
      }
      return prev;
    });
  }

  async function handleUpdateSessionActivity() {
    if (!supabase || !currentSessionId) {
      console.error('Supabase client not initialized or no active session');
      return;
    }

    try {
      await updateSessionActivity(supabase, currentSessionId);
      console.log('Session activity updated');
    } catch (error) {
      console.error('Error updating session activity:', error);
    }
  }

  // Update description when knowledge base is selected
  useEffect(() => {
    const selected = KNOWLEDGE_BASE_IDS.find(kb => kb.id === selectedKnowledgeBase);
    setKnowledgeBaseDescription(selected ? selected.description : '');
  }, [selectedKnowledgeBase]);

  useEffect(() => {
    if (avatar.current) {
      avatar.current.on(StreamingEvents.STREAM_DISCONNECTED, () => {
        console.log("Stream disconnected");
        if (currentSessionId) {
          handleEndSession();
        }
      });
    }
    return () => {
      if (avatar.current) {
        avatar.current.off(StreamingEvents.STREAM_DISCONNECTED);
      }
    };
  }, [avatar, handleEndSession, currentSessionId]);

  // Only handle beforeunload event
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (currentSessionId) {
        event.preventDefault();
        event.returnValue = '';
        handleEndSession();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [currentSessionId, handleEndSession]);

  async function handleSpeak() {
    setIsLoadingRepeat(true);
    if (!avatar.current) {
      setDebug("Avatar API not initialized");
      return;
    }
  
    setMessages(prev => [...prev, { speaker: 'User', text: text, isComplete: true }]);
  
    try {
      await avatar.current.speak({ text: text });
    } catch (e) {
      setDebug(e.message);
    }
  
    setIsLoadingRepeat(false);
    setText("");
  }

  async function handleInterrupt() {
    setDebug("Attempting to interrupt task...");
    if (!avatar.current) {
      setDebug("Avatar API not initialized");
      return;
    }
    try {
      await avatar.current.interrupt();
      setDebug("Task interrupted successfully");
    } catch (error) {
      console.error("Error interrupting task:", error);
      if (error.status === 400) {
        setDebug("No active task to interrupt or session has expired");
      } else {
        setDebug(`Error interrupting task: ${error.message}`);
      }
      // If the session has expired, we should end it
      if (error.status === 400) {
        await handleEndSession();
      }
    }
  }

  const handleChangeChatMode = useMemoizedFn(async (v) => {
    if (v === chatMode) {
      return;
    }
    if (v === "text_mode") {
      avatar.current?.closeVoiceChat();
    } else {
      await avatar.current?.startVoiceChat();
    }
    setChatMode(v);
  });

  const previousText = usePrevious(text);
  useEffect(() => {
    if (!previousText && text) {
      avatar.current?.startListening();
    } else if (previousText && !text) {
      avatar?.current?.stopListening();
    }
  }, [text, previousText]);

  useEffect(() => {
    return () => {
      handleEndSession();
    };
  }, []);

  useEffect(() => {
    if (stream && mediaStream.current) {
      mediaStream.current.srcObject = stream;
      mediaStream.current.onloadedmetadata = () => {
        mediaStream.current!.play();
        setDebug("Playing");
      };
    }
  }, [mediaStream, stream]);

  useEffect(() => {
    if (isUserTalking) {
      setMessages(prev => {
        const lastMessage = prev[prev.length - 1];
        if (lastMessage && lastMessage.speaker === 'User' && !lastMessage.isComplete) {
          return prev;
        } else {
          return [...prev, { speaker: 'User', text: '[Voice Input]', isComplete: false }];
        }
      });
    } else {
      setMessages(prev => {
        const lastMessage = prev[prev.length - 1];
        if (lastMessage && lastMessage.speaker === 'User' && !lastMessage.isComplete) {
          return [...prev.slice(0, -1), { ...lastMessage, isComplete: true }];
        }
        return prev;
      });
    }
  }, [isUserTalking]);

  const handleGenerateReport = async () => {
    if (!currentSessionId) return;

    setIsGeneratingReport(true);
    try {
      const response = await fetch('https://qhobnmjfjhxcgmmqxrbz.supabase.co/functions/v1/sendTranscript', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Add any necessary authentication headers here
        },
        body: JSON.stringify({ session_id: currentSessionId }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate report');
      }

      const result = await response.json();
      console.log(result.message);
      // You can add some UI feedback here, e.g., showing a success message
    } catch (error) {
      console.error('Error generating report:', error);
      // You can add some UI feedback here, e.g., showing an error message
    } finally {
      setIsGeneratingReport(false);
    }
  };

  return (
    <div className="w-full flex flex-col gap-4 p-4 min-h-screen">
      <Card className="w-full max-w-[1440px] mx-auto">
        <CardHeader>
          <CardTitle>Interactive Avatar</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col justify-center items-center">
          {stream ? (
            <div className="w-full h-[300px] sm:h-[400px] md:h-[500px] lg:h-[600px] relative rounded-lg overflow-hidden">
              <video
                ref={mediaStream}
                autoPlay
                playsInline
                className="w-full h-full object-contain"
              >
                <track kind="captions" />
              </video>
              <div className="flex flex-col gap-2 absolute bottom-3 right-3">
                <Button
                  variant="default"
                  onClick={handleInterrupt}
                  className="text-xs sm:text-sm"
                  disabled={!stream}
                >
                  Interrupt task
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleEndSession}
                  className="text-xs sm:text-sm"
                  disabled={!currentSessionId || isEndingSession}
                >
                  {isEndingSession ? "Ending..." : "End session"}
                </Button>
              </div>
            </div>
          ) : !isLoadingSession ? (
            <div className="w-full max-w-[400px] flex flex-col gap-4">
              <Select value={selectedKnowledgeBase} onValueChange={setSelectedKnowledgeBase}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a knowledge base" />
                </SelectTrigger>
                <SelectContent className="max-h-[200px] overflow-y-auto">
                  {KNOWLEDGE_BASE_IDS.map((kb) => (
                    <SelectItem key={kb.id} value={kb.id}>{kb.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={avatarId} onValueChange={setAvatarId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose an avatar" />
                </SelectTrigger>
                <SelectContent className="max-h-[200px] overflow-y-auto">
                  {AVATARS.map((avatar) => (
                    <SelectItem key={avatar.avatar_id} value={avatar.avatar_id}>{avatar.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a language" />
                </SelectTrigger>
                <SelectContent className="max-h-[200px] overflow-y-auto">
                  {STT_LANGUAGE_LIST.map((lang) => (
                    <SelectItem key={lang.key} value={lang.key}>{lang.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedKnowledgeBase && knowledgeBaseDescription && (
                <p className="text-sm text-muted-foreground mt-2 mb-4">
                  {knowledgeBaseDescription}
                </p>
              )}
              
              <Button
                variant="default"
                className="w-full"
                onClick={handleStartSession}
                disabled={!selectedKnowledgeBase || !avatarId || !language}
              >
                Start session
              </Button>
            </div>
          ) : (
            <div className="flex justify-center items-center h-[300px]">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          )}
        </CardContent>
        <Separator />
        <CardFooter className="flex flex-col gap-3">
          <div className="w-full text-center mb-2">
            <p className="text-sm text-muted-foreground">
              To have a video chat, please select "Voice mode"
            </p>
            <p className="text-sm text-muted-foreground">If you are not able to talk now, choose "Text mode"</p>
            <p className="text-sm text-muted-foreground">When you think it is enough, say this:</p>
            <p className="text-sm text-foreground">Let's finish the session. Give me a feedback</p>

          </div>
          <Tabs value={chatMode} onValueChange={handleChangeChatMode} className="w-full">
            <TabsList className="w-full">
              <TabsTrigger value="text_mode" className="flex-1">Text mode</TabsTrigger>
              <TabsTrigger value="voice_mode" className="flex-1">Voice mode</TabsTrigger>
            </TabsList>
          </Tabs>
          {chatMode === "text_mode" ? (
            <div className="w-full flex flex-col sm:flex-row gap-2">
              <Input
                disabled={!stream}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type something for the avatar to respond"
                className="flex-grow"
              />
              <Button 
                disabled={!stream || isLoadingRepeat}
                onClick={handleSpeak}
              >
                {isLoadingRepeat ? "Sending..." : "Send"}
              </Button>
            </div>
          ) : (
            <div className="w-full text-center">
              <Button
                disabled={!isUserTalking}
                variant={isUserTalking ? "default" : "outline"}
              >
                {isUserTalking ? "Listening" : "Voice chat"}
              </Button>
            </div>
          )}
          {/*<div 
            ref={transcriptRef}
            className="w-full mt-4 h-40 overflow-y-auto border border-input rounded p-2"
          >
            <h3 className="font-bold mb-2">Transcript:</h3>
            {messages.map((message, index) => (
              <p key={index} className={`text-sm mb-2 ${message.isComplete ? '' : 'text-muted-foreground'}`}>
                <strong>{message.speaker}:</strong> {message.text}
              </p>
            ))}
          </div> */}

          {/* Card Footer with Generate Report button - commented out for now */}
          {/*
          {user && sessionEnded && (
            <div className="mt-6 pt-4 border-t border-gray-200">
              <Button
                onClick={handleGenerateReport}
                className="w-full"
                variant="outline"
                disabled={isGeneratingReport}
              >
                {isGeneratingReport ? "Generating report..." : "Report will be sent to your email"}
              </Button>
            </div>
          )}
          */}
        </CardFooter>
      </Card>
      {/*<p className="font-mono text-right mt-4">
        <span className="font-bold">Console:</span>
        <br />
        {debug}
      </p> */}
    </div>
  );
}