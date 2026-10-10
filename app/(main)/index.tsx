import { StatusBar } from 'expo-status-bar';
import HomeTab, { type HomeTabProps } from './home';
import {
  Dimensions,
  View,
} from "react-native";



const { width: SCREEN_WIDTH } = Dimensions.get("window");

export default function MainTab({ insetTop, insetBottom }: HomeTabProps) {

  return (
    <>
        <View style={[{ flex: 1 ,}, { width: SCREEN_WIDTH }, {}]}>
                {/* <StatusBar style={isDark ? 'light' : 'dark'}  animated/> */}

            <HomeTab insetTop={insetTop} insetBottom={insetBottom} />
        </View>
    </>
  )
};